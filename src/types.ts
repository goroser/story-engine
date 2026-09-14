export type ChunkStatus = "draft" | "has_image";

export interface Chunk {
  id: string;
  order: number;
  text: string;
  image_prompt: string;
  image_url: string | null;
  status: ChunkStatus;
}

export interface Story {
  id: string;
  title: string;
  theme: string;
  age_level: string;
  /** Fixed character/style description prepended to every chunk's image prompt for visual consistency. */
  character_bible: string;
  /**
   * Absolute path to the approved character reference sheet, generated once
   * from character_bible alone (no scene content) and locked in via
   * approve_reference_image. Every generate_image call anchors on this
   * instead of chaining off other story chunks, so character design doesn't
   * drift as the book gets illustrated. Null until a candidate is approved.
   */
  reference_image: string | null;
  chunks: Chunk[];
  created_at: string;
  rating: string | null;
  notes: string | null;
}

export interface ChunkInput {
  text: string;
  image_prompt: string;
}
