// GET /api/stories — lightweight list for the gallery.
import { supabase } from "./_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const { data, error } = await supabase
    .from("stories")
    .select("id, title, theme, age_level, status, error_message, reference_image_path, created_at")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Attach a chunk count + page count per story without a second round trip
  // per story: one grouped query.
  const { data: counts } = await supabase.from("chunks").select("story_id");
  const countByStory = {};
  for (const row of counts || []) countByStory[row.story_id] = (countByStory[row.story_id] || 0) + 1;

  const stories = data.map((s) => ({ ...s, chunk_count: countByStory[s.id] || 0 }));
  res.status(200).json({ stories });
}
