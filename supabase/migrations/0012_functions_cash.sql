-- =============================================================================
-- 0012 — Caja: apertura, movimientos, cierre y reapertura.
-- =============================================================================

create or replace function open_cash_session(
  p_register uuid,
  p_opening_amount app.money default 0,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org      uuid := app.current_org_id();
  v_branch   uuid;
  v_session  uuid;
  v_number   text;
begin
  perform app.require_permission('cash.open');
  perform app.require(coalesce(p_opening_amount, 0) >= 0, 'El efectivo inicial no puede ser negativo');

  select branch_id into v_branch from cash_registers where id = p_register and organization_id = v_org;
  perform app.require(v_branch is not null, 'Caja inexistente');

  -- El índice único parcial `cash_sessions_one_open_uq` es la garantía real;
  -- esta verificación existe para devolver un mensaje entendible.
  if exists (select 1 from cash_sessions where register_id = p_register and status = 'open') then
    raise exception 'Ya hay una sesión de caja abierta. Cerrala antes de abrir otra.'
      using errcode = 'unique_violation';
  end if;

  v_number := app.next_document_number(v_org, 'cash_session', v_branch);

  insert into cash_sessions (
    organization_id, branch_id, register_id, number, opening_amount, opened_by, close_notes
  )
  values (v_org, v_branch, p_register, v_number, coalesce(p_opening_amount, 0), auth.uid(), p_notes)
  returning id into v_session;

  if coalesce(p_opening_amount, 0) > 0 then
    insert into cash_movements (
      organization_id, branch_id, session_id, movement_type, amount, affects_drawer,
      description, created_by
    )
    values (v_org, v_branch, v_session, 'opening', p_opening_amount, true,
            'Efectivo inicial declarado', auth.uid());
  end if;

  perform app.audit('open_cash_session', 'cash_session', v_session::text, null,
                    jsonb_build_object('register_id', p_register, 'opening_amount', p_opening_amount),
                    p_notes);
  return v_session;
end;
$$;

-- Sesión abierta de la sucursal del usuario, si existe.
create or replace function app.current_cash_session(p_branch uuid default null)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id
    from cash_sessions s
   where s.organization_id = app.current_org_id()
     and s.status = 'open'
     and s.branch_id = coalesce(p_branch, app.current_branch_id())
   order by s.opened_at desc
   limit 1
$$;

-- Movimiento de caja manual: ingreso, retiro o gasto.
create or replace function record_cash_movement(
  p_session uuid,
  p_type text,
  p_amount app.money,
  p_description text,
  p_payment_method uuid default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session cash_sessions;
  v_affects boolean := true;
  v_id      uuid;
  v_signed  app.money;
begin
  perform app.require_permission('cash.movement');
  perform app.require(p_amount > 0, 'El importe debe ser mayor a cero');
  perform app.require(p_type in ('income','withdrawal','expense','supplier_payment','adjustment'),
                      'Tipo de movimiento de caja no válido');

  select * into v_session from cash_sessions
   where id = p_session and organization_id = app.current_org_id() for update;
  perform app.require(found, 'Sesión de caja inexistente');
  perform app.require(v_session.status = 'open', 'La caja está cerrada: no admite movimientos');

  if p_payment_method is not null then
    select affects_cash_drawer into v_affects from payment_methods where id = p_payment_method;
  end if;

  -- Los ingresos suman; retiros, gastos y pagos restan.
  v_signed := case when p_type = 'income' then p_amount else -p_amount end;

  insert into cash_movements (
    organization_id, branch_id, session_id, movement_type, payment_method_id,
    amount, affects_drawer, description, reason, created_by
  )
  values (v_session.organization_id, v_session.branch_id, p_session, p_type, p_payment_method,
          v_signed, coalesce(v_affects, true), p_description, p_reason, auth.uid())
  returning id into v_id;

  perform app.audit('record_cash_movement', 'cash_movement', v_id::text, null,
                    jsonb_build_object('type', p_type, 'amount', v_signed), p_reason);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Esperado por medio de pago. Es la base del cierre.
-- -----------------------------------------------------------------------------
create or replace function app.cash_session_expected(p_session uuid)
returns table (
  payment_method_id uuid,
  label text,
  affects_drawer boolean,
  expected_amount app.money
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Efectivo: apertura + movimientos que tocan el cajón.
  select
    pm.id,
    pm.name,
    pm.affects_cash_drawer,
    (
      case when pm.affects_cash_drawer then
        coalesce((select s.opening_amount from cash_sessions s where s.id = p_session), 0)
      else 0 end
      + coalesce((
          select sum(cm.amount)
            from cash_movements cm
           where cm.session_id = p_session
             and cm.movement_type <> 'opening'
             and cm.payment_method_id = pm.id
        ), 0)
      + case when pm.affects_cash_drawer then
          coalesce((
            select sum(cm.amount)
              from cash_movements cm
             where cm.session_id = p_session
               and cm.movement_type <> 'opening'
               and cm.payment_method_id is null
               and cm.affects_drawer
          ), 0)
        else 0 end
    )::app.money
  from payment_methods pm
  where pm.organization_id = (select organization_id from cash_sessions where id = p_session)
    and pm.is_active
  order by pm.sort_order, pm.name
$$;

-- -----------------------------------------------------------------------------
-- Cierre general diario.
-- `p_declared` es un jsonb {"<payment_method_id>": {"amount": 1234.00, "reason": "..."}}
-- -----------------------------------------------------------------------------
create or replace function close_cash_session(
  p_session uuid,
  p_declared jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session   cash_sessions;
  v_version   int;
  v_expected  record;
  v_declared  app.money;
  v_reason    text;
  v_diff      app.money;
  v_cash_expected app.money := 0;
  v_cash_declared app.money := 0;
  v_result    jsonb := '[]'::jsonb;
begin
  perform app.require_permission('cash.close');

  select * into v_session from cash_sessions
   where id = p_session and organization_id = app.current_org_id() for update;
  perform app.require(found, 'Sesión de caja inexistente');
  perform app.require(v_session.status = 'open', 'La caja ya está cerrada');

  v_version := v_session.reopened_count + 1;

  for v_expected in select * from app.cash_session_expected(p_session) loop
    v_declared := coalesce((p_declared -> v_expected.payment_method_id::text ->> 'amount')::numeric, 0);
    v_reason   := p_declared -> v_expected.payment_method_id::text ->> 'reason';
    v_diff     := v_declared - v_expected.expected_amount;

    -- Una diferencia sin explicación no se guarda: hay que justificarla.
    if v_diff <> 0 and coalesce(btrim(v_reason), '') = '' then
      raise exception 'La diferencia en "%" (%) requiere un motivo',
        v_expected.label, to_char(v_diff, 'FM999999990.00')
        using errcode = 'check_violation';
    end if;

    insert into cash_close_breakdowns (
      organization_id, session_id, payment_method_id, label,
      expected_amount, declared_amount, difference, reason, close_version
    )
    values (v_session.organization_id, p_session, v_expected.payment_method_id, v_expected.label,
            v_expected.expected_amount, v_declared, v_diff, v_reason, v_version);

    if v_expected.affects_drawer then
      v_cash_expected := v_cash_expected + v_expected.expected_amount;
      v_cash_declared := v_cash_declared + v_declared;
    end if;

    v_result := v_result || jsonb_build_object(
      'payment_method_id', v_expected.payment_method_id,
      'label', v_expected.label,
      'expected', v_expected.expected_amount,
      'declared', v_declared,
      'difference', v_diff
    );
  end loop;

  update cash_sessions
     set status = 'closed',
         closed_at = now(),
         closed_by = auth.uid(),
         expected_cash = v_cash_expected,
         declared_cash = v_cash_declared,
         cash_difference = v_cash_declared - v_cash_expected,
         close_notes = coalesce(p_notes, close_notes)
   where id = p_session;

  perform app.audit('close_cash_session', 'cash_session', p_session::text, null,
                    jsonb_build_object('version', v_version, 'breakdown', v_result,
                                       'cash_difference', v_cash_declared - v_cash_expected),
                    p_notes);

  return jsonb_build_object(
    'session_id', p_session,
    'version', v_version,
    'cash_expected', v_cash_expected,
    'cash_declared', v_cash_declared,
    'cash_difference', v_cash_declared - v_cash_expected,
    'breakdown', v_result
  );
end;
$$;

-- Reapertura: solo el dueño, con motivo. El cierre original se conserva
-- (las filas de `cash_close_breakdowns` quedan con su `close_version`).
create or replace function reopen_cash_session(p_session uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_session cash_sessions;
begin
  perform app.require_owner();
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'La reapertura de caja requiere un motivo');

  select * into v_session from cash_sessions
   where id = p_session and organization_id = app.current_org_id() for update;
  perform app.require(found, 'Sesión de caja inexistente');
  perform app.require(v_session.status = 'closed', 'La caja no está cerrada');

  if exists (
    select 1 from cash_sessions
     where register_id = v_session.register_id and status = 'open'
  ) then
    raise exception 'No se puede reabrir: ya hay otra sesión abierta en esa caja'
      using errcode = 'unique_violation';
  end if;

  update cash_sessions
     set status = 'open',
         reopened_count = reopened_count + 1,
         closed_at = null,
         closed_by = null
   where id = p_session;

  perform app.audit('reopen_cash_session', 'cash_session', p_session::text,
                    to_jsonb(v_session), null, p_reason);
end;
$$;
