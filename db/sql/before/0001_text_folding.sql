-- Persian text, folded to one comparable form.
--
-- Applied BEFORE the table migrations, because `students.search_text` is a
-- generated column whose expression calls the function below: PostgreSQL will
-- not create the column unless the function already exists.
--
-- ── Why this is needed at all ────────────────────────────────────────────────
--
-- The same Persian name is routinely stored in several different byte
-- sequences, and none of them is a spelling mistake:
--
--   • Arabic yeh «ي» (U+064A) and Persian yeh «ی» (U+06CC) are different
--     characters that most keyboards produce interchangeably.
--   • The same is true of Arabic kaf «ك» (U+0643) and Persian kaf «ک» (U+06A9).
--   • «آ», «أ», «إ» all normalise to «ا» for the purpose of finding a person.
--   • A zero-width non-joiner sits inside «فارغ‌التحصیل» and inside a great many
--     compound family names, and is invisible in every interface that shows it.
--   • Digits arrive as ASCII «0-9», Arabic-Indic «٠-٩» or Persian «۰-۹»,
--     depending on which application typed them.
--
-- A clerk searching «سميه كريمي» from one keyboard must find «سمیه کریمی» filed
-- from another. Without folding they do not, the record looks absent, and the
-- clerk files a second copy of a person who was already there.

CREATE SCHEMA IF NOT EXISTS app;

-- Trigram matching, so a folded search is an index scan rather than a scan of
-- every student in the institution.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION app.fold_text(input text) RETURNS text
  LANGUAGE sql
  -- IMMUTABLE is a requirement, not an optimisation: a generated column and an
  -- expression index both refuse a function that is anything less.
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$
  SELECT btrim(
    regexp_replace(
      translate(
        translate(
          lower(input),
          -- Letters that are the same letter.
          --   yeh: ي ی ۍ ئ ې   → ی
          --   kaf: ك ک ڪ       → ک
          --   alef: آ أ إ ٱ ا   → ا
          --   heh: ة ۀ ه       → ه
          --   waw: ؤ و         → و
          'يیۍئېكکڪآأإٱاةۀهؤو',
          'یییییککککااااههههوو'
        ),
        -- Digits, in all three forms an Iranian keyboard produces.
        -- Folded to ASCII so «۴۰۰۱۲۳۴۵» finds a record filed as «40012345».
        '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
        '01234567890123456789'
      ),
      -- Everything invisible, replaced by a single space rather than removed.
      --
      -- Removed, «سهیل‌باقریان» would fold to «سهیلباقریان» — one word — while the
      -- same name typed with a real space folds to two. The two forms would stop
      -- matching each other, which is the precise failure this function exists
      -- to prevent. A space folds both to the same thing.
      --
      -- The class is: Arabic diacritics (U+064B–U+0652), tatweel (U+0640),
      -- zero-width non-joiner and joiner (U+200C, U+200D), zero-width space
      -- (U+200B), soft hyphen (U+00AD), and runs of ordinary whitespace.
      '[ً-ْـ​‌‍­\s]+',
      ' ',
      'g'
    )
  );
$$;

COMMENT ON FUNCTION app.fold_text(text) IS
  'Folds Persian/Arabic letter and digit variants to one comparable form. Used by students.search_text and by the register''s search predicate; both sides must fold identically or the index is silently useless.';

--------------------------------------------------------------------------------
-- A person's name, folded for comparison.
--
-- `app.fold_text` alone is not enough to match a minuted name against the
-- professor directory, and the reason is a convention rather than a bug: a
-- minute writes «دکتر محمدرضا اکبری» and the directory holds «محمدرضا اکبری».
-- Folded as they stand, the same academic is two people — so the examining
-- tally reports half their work under a name it cannot place.
--
-- Person-name search uses a fuzzy rule: substring containment,
-- then a 70% word overlap. That merges two academics who share a surname, which
-- is a worse failure than the one it fixes — it credits one person with
-- another's work, silently, on a report the faculty uses to distribute load.
--
-- This is precise instead. Two things are removed, both closed:
--
--   * a leading honorific, from a fixed list. «دکتر» is a title, not part of a
--     name, and no Iranian academic's given name is «دکتر»;
--   * a trailing parenthetical. The council minutes a guest examiner as
--     «دکتر مهدی رستمی (دانشگاه تهران)» — the affiliation belongs on the
--     printed minute and is not part of who they are.
--
-- Everything else is left alone. Two different people still fold to two
-- different keys.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fold_person(input text) RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$
  SELECT app.fold_text(
    btrim(
      regexp_replace(
        -- The affiliation the minute carries in brackets.
        regexp_replace(input, '\s*\([^)]*\)\s*$', '', 'g'),
        -- The honorifics, only at the start, and only as a whole word.
        '^\s*(جناب\s+آقای|سرکار\s+خانم|پروفسور|دکتر|مهندس|آقای|خانم)\s+',
        '',
        'i'
      )
    )
  );
$$;

COMMENT ON FUNCTION app.fold_person(text) IS
  'Folds a person name for comparison: strips a leading honorific and a trailing parenthetical affiliation, then folds letter and digit variants. Matches minuted examiner names against the professor directory.';
