-- Colours are "up to 3, dominant first" (docs/styling-engine.md, itemColourScore). Tighten from 4 to 3.
-- Safe on the shared DB: the table was empty when this ran.
alter table public.clothing_items drop constraint clothing_items_colours_check;
alter table public.clothing_items add constraint clothing_items_colours_check check (
  cardinality(colours) <= 3 and array_position(colours, null) is null and colours <@ array[
    'black', 'white', 'off_white', 'grey', 'charcoal', 'silver', 'gold', 'navy', 'beige', 'camel',
    'brown', 'olive', 'denim_blue', 'red', 'burgundy', 'pink', 'orange', 'rust', 'yellow', 'mustard',
    'green', 'forest_green', 'mint', 'teal', 'light_blue', 'blue', 'purple', 'lavender'
  ]::text[]
);
