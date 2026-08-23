-- Utilidades de prueba. Se cargan antes que el resto de los archivos.
create schema if not exists test;
grant usage on schema test to public;

create or replace function test.assert(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'FALLA: %', p_label;
  end if;
  raise notice '  ok · %', p_label;
end $$;

create or replace function test.assert_eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FALLA: % (esperado %, obtenido %)', p_label, p_expected, p_actual;
  end if;
  raise notice '  ok · % (%)', p_label, p_actual;
end $$;

-- Sobrecarga numérica: los dominios app.qty / app.money no unifican con
-- `anyelement`, así que las comparaciones de cantidades e importes usan esta.
create or replace function test.assert_eq(p_actual numeric, p_expected numeric, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FALLA: % (esperado %, obtenido %)', p_label, p_expected, p_actual;
  end if;
  raise notice '  ok · % (%)', p_label, p_actual;
end $$;

-- Ejecuta SQL y verifica que falle con un mensaje que contenga el patrón dado.
create or replace function test.assert_raises(p_sql text, p_pattern text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_pattern) in lower(sqlerrm)) = 0 then
      raise exception 'FALLA: % — falló pero con otro mensaje: %', p_label, sqlerrm;
    end if;
    raise notice '  ok · % (rechazado: %)', p_label, left(sqlerrm, 70);
    return;
  end;
  raise exception 'FALLA: % — la operación debió ser rechazada y no lo fue', p_label;
end $$;

-- Actúa como un usuario concreto, con RLS activa.
create or replace function test.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, false);
  execute 'set role authenticated';
end $$;

create or replace function test.act_as_admin()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;

create or replace function test.owner_id() returns uuid language sql as
$$ select '44444444-4444-4444-4444-444444444441'::uuid $$;
create or replace function test.employee_id() returns uuid language sql as
$$ select '44444444-4444-4444-4444-444444444442'::uuid $$;
create or replace function test.sku(p text) returns uuid language sql as
$$ select id from product_variants where sku = p $$;
create or replace function test.location(p text) returns uuid language sql as
$$ select id from stock_locations where code = p $$;
create or replace function test.method(p text) returns uuid language sql as
$$ select id from payment_methods where code = p $$;

grant execute on all functions in schema test to public;
