-- =====================================================================
-- CDNA Tracker - database setup
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run once on a fresh project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- Everyone on the roster.
create table public.people (
  id           uuid primary key default gen_random_uuid(),
  last_name    text not null check (btrim(last_name) <> ''),
  first_name   text not null check (btrim(first_name) <> ''),
  middle_name  text not null default '',
  email        text not null unique
                 check (email = lower(btrim(email)) and email ~ '^[^@\s,]+@[^@\s,]+\.[^@\s,]+$'),
  class_year   int  not null check (class_year between 2000 and 2100),
  balance      int  not null default 0 check (balance >= 0),
  on_probation boolean not null default false,
  active       boolean not null default true,   -- false = removed from roster (history is kept)
  created_at   timestamptz not null default now()
);

-- Every change to anyone's CDNAs: earned, used, refunded, adjusted,
-- plus probation changes. Rows are never edited or deleted.
create table public.cdna_log (
  id            bigint generated always as identity primary key,
  person_id     uuid not null references public.people(id),
  kind          text not null check (kind in ('award','use','refund','remove','probation_on','probation_off')),
  amount        int  not null,          -- +N earned/refunded, -N used/removed, 0 for probation
  reason        text,                   -- required for admin actions
  dates         date[],                 -- the days a CDNA was used for
  actor         text not null,          -- 'self' for requests, otherwise the admin's email
  balance_after int  not null,
  reverses      bigint references public.cdna_log(id),  -- for refunds: the 'use' row being undone
  created_at    timestamptz not null default now()
);
create index cdna_log_person_idx on public.cdna_log(person_id, created_at desc);
create unique index cdna_log_one_refund_per_use on public.cdna_log(reverses) where reverses is not null;

-- One row per day someone has a CDNA, so the same day can't be used twice.
create table public.cdna_days (
  person_id uuid not null references public.people(id),
  day       date not null,
  log_id    bigint not null references public.cdna_log(id),
  primary key (person_id, day)
);

-- Emails of people allowed to use the admin page.
create table public.admins (
  email text primary key check (email = lower(btrim(email)))
);

-- ---------------------------------------------------------------------
-- Security: nobody can touch the tables directly from the website.
-- The public page only gets what the functions below hand out.
-- ---------------------------------------------------------------------
alter table public.people    enable row level security;
alter table public.cdna_log  enable row level security;
alter table public.cdna_days enable row level security;
alter table public.admins    enable row level security;

-- True when the signed-in user is a confirmed account listed in admins.
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from auth.users u
    join public.admins a on a.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

-- Admins can read everything (for the admin page); all writes go through functions.
create policy "admins read people"    on public.people    for select using (public.is_admin());
create policy "admins read log"       on public.cdna_log  for select using (public.is_admin());
create policy "admins read days"      on public.cdna_days for select using (public.is_admin());
create policy "admins read admins"    on public.admins    for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- "Today" for the squadron (Mountain time), not the server's UTC date.
create or replace function public.cdna_today()
returns date language sql stable
as $$ select (now() at time zone 'America/Denver')::date $$;

-- e.g. "Tue 13 Oct"
create or replace function public.cdna_fmt(d date)
returns text language sql immutable
as $$ select to_char(d, 'Dy FMDD Mon') $$;

-- The next weekday after d (Friday -> Monday).
create or replace function public.cdna_next_weekday(d date)
returns date language sql immutable
as $$ select case extract(isodow from d)::int when 5 then d + 3 when 6 then d + 2 else d + 1 end $$;

-- ---------------------------------------------------------------------
-- Public functions (used by the tracker page, no login)
-- ---------------------------------------------------------------------

-- Names, class years and balances for the board. No emails, no probation.
create or replace function public.get_board()
returns table (id uuid, last_name text, first_name text, class_year int, balance int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select id, last_name, first_name, class_year, balance
  from public.people
  where active
  order by class_year, lower(last_name), lower(first_name);
$$;

-- Step 1 of a request: look someone up by email.
create or replace function public.cdna_lookup(p_email text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  p public.people;
begin
  select * into p from public.people
  where email = lower(btrim(coalesce(p_email, ''))) and active;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found',        true,
    'first_name',   p.first_name,
    'last_name',    p.last_name,
    'class_year',   p.class_year,
    'balance',      p.balance,
    'on_probation', p.on_probation,
    'today',        public.cdna_today(),
    'booked_days',  coalesce((
                      select jsonb_agg(day order by day) from public.cdna_days
                      where person_id = p.id and day >= public.cdna_today()), '[]'::jsonb)
  );
end;
$$;

-- Use CDNAs. Checks every rule, and only if all pass, takes the CDNAs
-- and records the days in one step. Returns every failed rule at once.
create or replace function public.request_cdna(p_email text, p_dates date[])
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  p        public.people;
  v_today  date := public.cdna_today();
  v_dates  date[];
  v_weekdays date[];
  v_errors text[] := '{}';
  v_bad    text;
  v_needed int;
  v_log_id bigint;
  i        int;
begin
  -- Who is asking?
  select * into p from public.people
  where email = lower(btrim(coalesce(p_email, ''))) and active
  for update;   -- lock this person's row so two clicks can't both spend the same CDNA

  if not found then
    return jsonb_build_object('ok', false,
      'errors', jsonb_build_array('That email isn''t on the roster. Check the spelling, or ask an admin to add you.'));
  end if;

  -- Which days?
  if p_dates is null or cardinality(p_dates) = 0 then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('Pick at least one day.'));
  end if;

  select array_agg(distinct d order by d) into v_dates
  from unnest(p_dates) as d where d is not null;

  if cardinality(v_dates) <> cardinality(p_dates) then
    v_errors := v_errors || 'The same day was picked more than once.'::text;
  end if;

  v_needed := cardinality(v_dates);

  -- Rule: not on probation
  if p.on_probation then
    v_errors := v_errors || 'You can''t use a CDNA while on probation.'::text;
  end if;

  -- Rule: no past dates
  select string_agg(public.cdna_fmt(d), ', ' order by d) into v_bad
  from unnest(v_dates) d where d < v_today;
  if v_bad is not null then
    v_errors := v_errors || ('CDNA days can''t be in the past (' || v_bad || ').');
  end if;

  -- Rule: weekdays only
  select string_agg(public.cdna_fmt(d), ', ' order by d) into v_bad
  from unnest(v_dates) d where extract(isodow from d) in (6, 7);
  if v_bad is not null then
    v_errors := v_errors || ('CDNAs can only be used on weekdays (' || v_bad || ' is a weekend).');
  end if;

  -- Rule: multi-day must be back-to-back weekdays (Fri -> Mon counts as back-to-back)
  select array_agg(d order by d) into v_weekdays
  from unnest(v_dates) d where extract(isodow from d) not in (6, 7);
  if cardinality(v_weekdays) > 1 then
    for i in 2 .. cardinality(v_weekdays) loop
      if v_weekdays[i] <> public.cdna_next_weekday(v_weekdays[i - 1]) then
        v_errors := v_errors || ('Multi-day CDNAs must be back-to-back weekdays (there''s a gap between '
                                 || public.cdna_fmt(v_weekdays[i - 1]) || ' and ' || public.cdna_fmt(v_weekdays[i]) || ').');
        exit;
      end if;
    end loop;
  end if;

  -- Rule: no day already covered by an earlier CDNA
  select string_agg(public.cdna_fmt(c.day), ', ' order by c.day) into v_bad
  from public.cdna_days c where c.person_id = p.id and c.day = any(v_dates);
  if v_bad is not null then
    v_errors := v_errors || ('You already have a CDNA on ' || v_bad || '.');
  end if;

  -- Rule: enough CDNAs in the bank
  if p.balance = 0 then
    v_errors := v_errors || 'You don''t have any CDNAs left.'::text;
  elsif v_needed > p.balance then
    v_errors := v_errors || ('This request needs ' || v_needed || ' CDNAs but you only have ' || p.balance || '.');
  end if;

  if cardinality(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', to_jsonb(v_errors), 'balance', p.balance);
  end if;

  -- All rules passed: spend, log and book the days.
  update public.people set balance = balance - v_needed where id = p.id;

  insert into public.cdna_log (person_id, kind, amount, dates, actor, balance_after)
  values (p.id, 'use', -v_needed, v_dates, 'self', p.balance - v_needed)
  returning id into v_log_id;

  insert into public.cdna_days (person_id, day, log_id)
  select p.id, d, v_log_id from unnest(v_dates) d;

  return jsonb_build_object(
    'ok',          true,
    'log_id',      v_log_id,
    'first_name',  p.first_name,
    'middle_name', p.middle_name,
    'last_name',   p.last_name,
    'class_year',  p.class_year,
    'dates',       to_jsonb(v_dates),
    'used',        v_needed,
    'balance',     p.balance - v_needed,
    'issued_on',   v_today
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Admin functions (admin page, signed in)
-- ---------------------------------------------------------------------

create or replace function public.cdna_require_admin()
returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_email text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can do this.' using errcode = '42501';
  end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  return v_email;
end;
$$;

create or replace function public.am_i_admin()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$ select public.is_admin() $$;

-- Award (amount > 0) or remove (amount < 0) CDNAs for one or more people.
create or replace function public.admin_award(p_person_ids uuid[], p_amount int, p_reason text)
returns int
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_admin text := public.cdna_require_admin();
  p public.people;
  n int := 0;
begin
  if p_amount is null or p_amount = 0 then
    raise exception 'Enter how many CDNAs to award or remove.';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required.';
  end if;
  if p_person_ids is null or cardinality(p_person_ids) = 0 then
    raise exception 'Pick at least one person.';
  end if;

  for p in select * from public.people where id = any(p_person_ids) order by last_name for update loop
    if p.balance + p_amount < 0 then
      raise exception '% % only has % CDNA(s), so % can''t be removed. Nothing was changed.',
        p.first_name, p.last_name, p.balance, -p_amount;
    end if;
    update public.people set balance = balance + p_amount where id = p.id;
    insert into public.cdna_log (person_id, kind, amount, reason, actor, balance_after)
    values (p.id, case when p_amount > 0 then 'award' else 'remove' end,
            p_amount, btrim(p_reason), v_admin, p.balance + p_amount);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Undo a CDNA someone used: gives the CDNAs back and frees the days.
create or replace function public.admin_refund(p_log_id bigint, p_reason text)
returns int
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_admin text := public.cdna_require_admin();
  l public.cdna_log;
  p public.people;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required.';
  end if;
  select * into l from public.cdna_log where id = p_log_id;
  if not found or l.kind <> 'use' then
    raise exception 'That entry isn''t a used CDNA.';
  end if;
  if exists (select 1 from public.cdna_log where reverses = l.id) then
    raise exception 'That CDNA was already refunded.';
  end if;

  select * into p from public.people where id = l.person_id for update;
  update public.people set balance = balance - l.amount where id = p.id;   -- amount is negative
  delete from public.cdna_days where log_id = l.id;
  insert into public.cdna_log (person_id, kind, amount, reason, dates, actor, balance_after, reverses)
  values (p.id, 'refund', -l.amount, btrim(p_reason), l.dates, v_admin, p.balance - l.amount, l.id);
  return -l.amount;
end;
$$;

create or replace function public.admin_set_probation(p_person_id uuid, p_on boolean, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_admin text := public.cdna_require_admin();
  p public.people;
begin
  select * into p from public.people where id = p_person_id for update;
  if not found then raise exception 'Person not found.'; end if;
  if p.on_probation = p_on then return; end if;
  update public.people set on_probation = p_on where id = p.id;
  insert into public.cdna_log (person_id, kind, amount, reason, actor, balance_after)
  values (p.id, case when p_on then 'probation_on' else 'probation_off' end, 0,
          nullif(btrim(coalesce(p_reason, '')), ''), v_admin, p.balance);
end;
$$;

-- Add (p_id null) or edit a person. Does not change balances.
create or replace function public.admin_save_person(
  p_id uuid, p_last text, p_first text, p_middle text, p_email text, p_class_year int)
returns uuid
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_admin text := public.cdna_require_admin();
  v_id uuid;
begin
  if p_id is null then
    insert into public.people (last_name, first_name, middle_name, email, class_year)
    values (btrim(p_last), btrim(p_first), btrim(coalesce(p_middle, '')), lower(btrim(p_email)), p_class_year)
    returning id into v_id;
  else
    update public.people
       set last_name = btrim(p_last), first_name = btrim(p_first),
           middle_name = btrim(coalesce(p_middle, '')), email = lower(btrim(p_email)),
           class_year = p_class_year
     where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Remove someone from the board (or bring them back). Their history stays.
create or replace function public.admin_set_active(p_id uuid, p_active boolean)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare v_admin text := public.cdna_require_admin();
begin
  update public.people set active = p_active where id = p_id;
end;
$$;

-- Import a roster: [{last_name, first_name, middle_name, email, class_year}, ...]
-- New emails are added with 0 CDNAs; existing emails get their name/class updated.
create or replace function public.admin_import_roster(p_rows jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_admin text := public.cdna_require_admin();
  r jsonb;
  v_added int := 0;
  v_updated int := 0;
  v_existed boolean;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    v_existed := exists (select 1 from public.people where email = lower(btrim(r->>'email')));
    insert into public.people (last_name, first_name, middle_name, email, class_year)
    values (btrim(r->>'last_name'), btrim(r->>'first_name'), btrim(coalesce(r->>'middle_name', '')),
            lower(btrim(r->>'email')), (r->>'class_year')::int)
    on conflict (email) do update
      set last_name = excluded.last_name, first_name = excluded.first_name,
          middle_name = excluded.middle_name, class_year = excluded.class_year, active = true;
    if v_existed then v_updated := v_updated + 1; else v_added := v_added + 1; end if;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_updated);
end;
$$;

-- ---------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------
revoke all on function public.cdna_require_admin()  from public, anon;
revoke all on function public.admin_award(uuid[], int, text)          from public, anon;
revoke all on function public.admin_refund(bigint, text)              from public, anon;
revoke all on function public.admin_set_probation(uuid, boolean, text) from public, anon;
revoke all on function public.admin_save_person(uuid, text, text, text, text, int) from public, anon;
revoke all on function public.admin_set_active(uuid, boolean)         from public, anon;
revoke all on function public.admin_import_roster(jsonb)              from public, anon;

grant execute on function public.get_board()                 to anon, authenticated;
grant execute on function public.cdna_lookup(text)           to anon, authenticated;
grant execute on function public.request_cdna(text, date[])  to anon, authenticated;
grant execute on function public.am_i_admin()                to anon, authenticated;

grant execute on function public.is_admin()                  to anon, authenticated;
grant execute on function public.cdna_require_admin()        to authenticated;
grant execute on function public.admin_award(uuid[], int, text)           to authenticated;
grant execute on function public.admin_refund(bigint, text)               to authenticated;
grant execute on function public.admin_set_probation(uuid, boolean, text) to authenticated;
grant execute on function public.admin_save_person(uuid, text, text, text, text, int) to authenticated;
grant execute on function public.admin_set_active(uuid, boolean)          to authenticated;
grant execute on function public.admin_import_roster(jsonb)               to authenticated;

-- ---------------------------------------------------------------------
-- Admins: put the email(s) you'll sign in to the admin page with here,
-- then create the same account(s) under Authentication > Users > Add user.
-- ---------------------------------------------------------------------
insert into public.admins (email) values
  ('c29zachary.fernandez@afacademy.af.edu');   -- <-- change this
