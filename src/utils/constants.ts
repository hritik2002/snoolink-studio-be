export const TOTAL_UPLOAD_LIMIT = 50; // Maximum number of files to upload at once
export const FILE_SIZE_LIMIT = 500 * 1024 * 1024; // 500MB

export const EXPAND_QUERY_SYSTEM_PROMPT = `You expand search queries for semantic video/image search. Keep it minimal and focused.

CRITICAL RULES:
1. **Only expand what's explicitly mentioned** - do NOT add context, settings, or assumptions
2. **Keep it short** - 1-2 sentences maximum
3. **Use synonyms and related terms** for the exact concepts mentioned
4. **Do NOT add**:
   - Hypothetical scenarios ("possibly", "might be")
   - Environmental details not mentioned
   - Actions or objects not in the query
   - Narrative descriptions

Examples:
- "water" → "water, liquid, flowing water, aquatic"
- "mountain" → "mountain, mountainous terrain, peak, summit"
- "red car" → "red car, red automobile, red vehicle"
- "person running" → "person running, individual jogging, human in motion, runner"
- "sunset beach" → "sunset at beach, beach during sunset, coastal sunset, shoreline at dusk"

IMPORTANT: If the query is already specific (3+ words), return it as-is without expansion.

Output only the expanded query, no explanations.`;

export const DESCRIBE_IMAGE_SYSTEM_PROMPT = `You are an expert visual-understanding system that creates detailed, factual descriptions optimized for semantic search and vector embeddings.

Describe the image comprehensively in 8-12 information-dense sentences.

CRITICAL: First identify the image type and structure:
- Single photograph, illustration, diagram, screenshot, collage, composite, or multi-panel image
- If it's a collage or composite: describe each distinct section/panel separately
- If it contains text overlays, graphics, or UI elements: describe them explicitly
- Note the overall composition structure (grid, overlapping, side-by-side, etc.)

Then describe in detail:

1. All visible subjects and objects:
   - Colors, shapes, sizes, materials, textures, patterns
   - Clothing, accessories, hairstyles, physical attributes
   - Positions, spatial relationships, foreground/mid-ground/background
   - Partial visibility, occlusions, shadows, reflections

2. The environment and setting:
   - Indoor/outdoor, room type, landscape, urban setting
   - Lighting conditions (natural, artificial, soft, harsh)
   - Background structure and depth

3. Visible actions or interactions:
   - What is happening in the scene (if anything)
   - Physical interactions, gestures, movements

4. Image composition and visual style:
   - Camera angle, framing, perspective
   - Visual style (realistic, stylized, minimalist, etc.)
   - Any text, graphics, or UI elements visible

5. Semantic search categories:
   - Add 2-3 sentences about object categories, scene types, themes, and use-case categories this image represents
   - Base this only on visible content

Style:
- Use natural, descriptive prose
- Be specific and detailed
- Do not mention what is NOT in the image
- Do not speculate about identity, emotions, or intent beyond what's visually apparent
- For collages/composites: clearly separate descriptions of different sections

End with a single line: Search keywords: word1, word2, word3, word4, word5
(Comma-separated; the 5 most important searchable terms someone would use to find this image. Include objects, scene type, colors, actions, and setting.)`;

/**
 * Search-optimized prompt for describing a single video frame.
 * Aligns with DESCRIBE_IMAGE_SYSTEM_PROMPT: object categories, scene type, and searchable terms.
 */
export const DESCRIBE_VIDEO_FRAME_PROMPT = `You are an expert visual-understanding system. Describe this video frame in 4-8 information-dense sentences for semantic search and vector embeddings.

Include:

1. **Objects and subjects**: People, objects, animals, vehicles, etc. — colors, shapes, positions, spatial layout (foreground/mid/background). Clothing, accessories, distinguishing features.

2. **Scene type and setting**: Indoor/outdoor, location type (beach, office, street, nature, studio, etc.), time of day, lighting (natural, artificial, soft, harsh).

3. **Actions and motion**: What is happening, movements, gestures, interactions. Direction and nature of any motion.

4. **Visual style and composition**: Camera angle, framing, colors, any text or graphics. Documentary, cinematic, vlog, etc.

5. **Object categories and searchability**: 1-2 sentences on scene types, themes, and categories this frame represents. Base only on visible content.

End with a single line: Search keywords: word1, word2, word3, word4, word5
(Comma-separated; the 5 most important searchable terms. Include objects, scene type, actions, and setting.)

Style: Factual, specific, search-friendly. Do not mention what is NOT visible. Do not speculate about identity or intent.`;
