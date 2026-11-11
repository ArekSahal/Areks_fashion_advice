-- Defence in depth on top of RLS: signed-out users get nothing; signed-in users can only select and update allowed columns.
revoke all on public.profiles from anon;
revoke insert, delete, truncate, references, trigger on public.profiles from authenticated;
