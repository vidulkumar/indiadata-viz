-- Live-linked layers: store only the mapping definition, never the source rows.
ALTER TABLE public.community_layers
  ADD COLUMN IF NOT EXISTS source_mode text NOT NULL DEFAULT 'snapshot',
  ADD COLUMN IF NOT EXISTS live_config jsonb;

ALTER TABLE public.community_layers DROP CONSTRAINT IF EXISTS community_layers_source_mode_check;
ALTER TABLE public.community_layers
  ADD CONSTRAINT community_layers_source_mode_check CHECK (source_mode IN ('snapshot', 'live'));

-- A live layer must carry a config; a snapshot layer must not.
ALTER TABLE public.community_layers DROP CONSTRAINT IF EXISTS community_layers_live_config_check;
ALTER TABLE public.community_layers
  ADD CONSTRAINT community_layers_live_config_check
  CHECK ((source_mode = 'live') = (live_config IS NOT NULL));

-- The app already supports transit corridors, so allow 'line' layers too.
ALTER TABLE public.community_layers DROP CONSTRAINT IF EXISTS community_layers_layer_type_check;
ALTER TABLE public.community_layers
  ADD CONSTRAINT community_layers_layer_type_check
  CHECK (layer_type = ANY (ARRAY['point'::text, 'choropleth'::text, 'line'::text]));
