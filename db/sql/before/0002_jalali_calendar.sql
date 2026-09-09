-- One authoritative Persian-calendar boundary for SQL.
--
-- JavaScript presentation uses date-fns-jalali, while reports, dashboard
-- aggregates and certificate numbering also need the calendar *inside*
-- PostgreSQL. Treating Nowruz as an unconditional 21 March is only an
-- approximation: in years such as 1403 the year begins on 20 March. A one-day
-- error is enough to put a council sitting or certificate into the wrong
-- reporting year.
--
-- The calculation below is the Borkowski break-year algorithm used by the
-- common Jalaali conversion implementations. It is deterministic over the
-- supported Jalaali range (-61..3177), so the functions are safe to mark
-- IMMUTABLE and to use in grouping/filter expressions.

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.jalali_new_year(jy integer) RETURNS date
  LANGUAGE plpgsql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$
DECLARE
  breaks integer[] := ARRAY[
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181,
    1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178
  ];
  last_index integer := array_length(breaks, 1);
  gy integer := jy + 621;
  leap_j integer := -14;
  leap_g integer;
  jp integer := breaks[1];
  jm integer;
  jump integer := 0;
  n integer;
  march_day integer;
  index integer;
BEGIN
  IF jy < breaks[1] OR jy >= breaks[last_index] THEN
    RAISE EXCEPTION 'Jalaali year % is outside the supported range %..%',
      jy, breaks[1], breaks[last_index] - 1;
  END IF;

  FOR index IN 2..last_index LOOP
    jm := breaks[index];
    jump := jm - jp;
    IF jy < jm THEN
      EXIT;
    END IF;
    leap_j := leap_j + (jump / 33) * 8 + ((jump % 33) / 4);
    jp := jm;
  END LOOP;

  n := jy - jp;
  leap_j := leap_j + (n / 33) * 8 + (((n % 33) + 3) / 4);
  IF (jump % 33) = 4 AND (jump - n) = 4 THEN
    leap_j := leap_j + 1;
  END IF;

  leap_g := (gy / 4) - (((gy / 100) + 1) * 3 / 4) - 150;
  march_day := 20 + leap_j - leap_g;
  RETURN make_date(gy, 3, march_day);
END;
$$;

COMMENT ON FUNCTION app.jalali_new_year(integer) IS
  'Gregorian date of Farvardin 1 for a Jalaali year, using the Borkowski break-year algorithm.';

CREATE OR REPLACE FUNCTION app.jalali_year(input date) RETURNS integer
  LANGUAGE plpgsql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$
DECLARE
  candidate integer := extract(year from input)::integer - 621;
BEGIN
  IF input < app.jalali_new_year(candidate) THEN
    RETURN candidate - 1;
  END IF;
  RETURN candidate;
END;
$$;

COMMENT ON FUNCTION app.jalali_year(date) IS
  'Jalaali year containing a Gregorian date. Shared by reports, dashboard aggregates and annual numbering.';

CREATE OR REPLACE FUNCTION app.jalali_month(input date) RETURNS integer
  LANGUAGE plpgsql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$
DECLARE
  jy integer := app.jalali_year(input);
  day_offset integer := input - app.jalali_new_year(jy);
BEGIN
  IF day_offset < 186 THEN
    RETURN (day_offset / 31) + 1;
  END IF;
  RETURN ((day_offset - 186) / 30) + 7;
END;
$$;

COMMENT ON FUNCTION app.jalali_month(date) IS
  'Jalaali month number (1..12) containing a Gregorian date, derived from the exact Nowruz boundary.';
