#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const REPLICATE_TOOL: Tool = {
  name: "replicate_image_generate",
  description: "Generates images using Replicate's Flux 1.1 Pro Ultra model",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        title: "Prompt",
        description: "Text prompt for image generation"
      },
      raw: {
        type: "boolean",
        title: "Raw",
        description: "Generate less processed, more natural-looking images",
        default: false
      },
      seed: {
        type: "integer",
        title: "Seed",
        description: "Random seed. Set for reproducible generation"
      },
      aspect_ratio: {
        type: "string",
        title: "aspect_ratio",
        description: "Aspect ratio for the generated image",
        default: "1:1",
        enum: ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "9:21"]
      },
      image_prompt: {
        type: "string",
        title: "Image Prompt",
        description: "Image to use with Flux Redux. Used together with text prompt to guide generation",
        format: "uri"
      },
      output_format: {
        type: "string",
        title: "output_format",
        description: "Format of the output images",
        default: "jpg",
        enum: ["jpg", "png"]
      },
      safety_tolerance: {
        type: "integer",
        title: "Safety Tolerance",
        description: "Safety tolerance, 1 is most strict and 6 is most permissive",
        default: 2,
        minimum: 1,
        maximum: 6
      },
      image_prompt_strength: {
        type: "number",
        title: "Image Prompt Strength",
        description: "Blend between the prompt and the image prompt",
        default: 0.1,
        minimum: 0,
        maximum: 1
      }
    },
    required: ["prompt"]
  }
};

const server = new Server(
  {
    name: "noeltg77/replicate-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN!;
if (!REPLICATE_API_TOKEN) {
  console.error("Error: REPLICATE_API_TOKEN environment variable is required");
  process.exit(1);
}

interface ReplicateInput {
  prompt: string;
  raw?: boolean;
  seed?: number;
  aspect_ratio?: string;
  image_prompt?: string;
  output_format?: string;
  safety_tolerance?: number;
  image_prompt_strength?: number;
}

interface ReplicateRequest {
  input: ReplicateInput;
}

interface ReplicateResponse {
  id: string;
  status: string;
  output?: string[];
  error?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getPredictionStatus(id: string): Promise<ReplicateResponse> {
  const response = await fetch(
    `https://api.replicate.com/v1/predictions/${id}`,
    {
      headers: {
        "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Replicate API error: ${response.status} ${response.statusText}\n${await response.text()}`);
  }

  return response.json() as Promise<ReplicateResponse>;
}

async function generateImage(params: ReplicateInput): Promise<string> {
  const requestBody: ReplicateRequest = {
    input: {
      prompt: params.prompt,
      raw: params.raw ?? false,
      seed: params.seed,
      aspect_ratio: params.aspect_ratio ?? "1:1",
      image_prompt: params.image_prompt,
      output_format: params.output_format ?? "jpg",
      safety_tolerance: params.safety_tolerance ?? 2,
      image_prompt_strength: params.image_prompt_strength ?? 0.1,
    },
  };

  // Create prediction
  const response = await fetch(
    "https://api.replicate.com/v1/predictions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    }
  );

  if (!response.ok) {
    throw new Error(`Replicate API error: ${response.status} ${response.statusText}\n${await response.text()}`);
  }

  const prediction = await response.json() as ReplicateResponse;
  
  // Poll for completion
  const MAX_ATTEMPTS = 60;
  const POLL_INTERVAL = 2000; // 2 seconds
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    const status = await getPredictionStatus(prediction.id);
    
    if (status.error) {
      throw new Error(`Replicate API error: ${status.error}`);
    }

    if (status.status === "succeeded" && status.output && status.output.length > 0) {
      return status.output[0];
    }

    if (status.status === "failed") {
      throw new Error("Image generation failed");
    }

    await sleep(POLL_INTERVAL);
    attempts++;
  }

  throw new Error("Timeout waiting for image generation");
}

function isReplicateArgs(args: unknown): args is ReplicateInput {
  return (
    typeof args === "object" &&
    args !== null &&
    "prompt" in args &&
    typeof (args as { prompt: string }).prompt === "string"
  );
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [REPLICATE_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new Error("No arguments provided");
    }

    if (name === "replicate_image_generate") {
      if (!isReplicateArgs(args)) {
        throw new Error("Invalid arguments for replicate_image_generate");
      }
      const imageUrl = await generateImage(args);
      return {
        content: [{ type: "text", text: `Generated image URL: ${imageUrl}` }],
        isError: false,
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Replicate MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
