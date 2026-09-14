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
  chunks: Chunk[];
  created_at: string;
  rating: string | null;
  notes: string | null;
}

export interface ChunkInput {
  text: string;
  image_prompt: string;
}
