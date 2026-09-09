-- Which university this deployment *is*, as a `universities` vocabulary value.
--
-- The capacity regulation's proviso 7 halves a joint supervision only between
-- members of this university's own faculty, and nothing recorded which one that
-- is: a tenant-bound register cannot hard-code a single university's key, which a
-- product serving many of them cannot do.
--
-- Empty by default and left empty here on purpose. Guessing it from the
-- institution's name would be a guess on the figure that decides whether a
-- colleague may take another student; the capacity screen reports it as an
-- unsupplied input until an administrator sets it in the institution profile.

ALTER TABLE "institutions" ADD COLUMN "university" text DEFAULT '' NOT NULL;