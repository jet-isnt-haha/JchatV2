import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface ResearchSearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

@Injectable()
export class TavilyResearchSearchAdapter {
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get(
      "TAVILY_BASE_URL",
      "https://api.tavily.com",
    );
  }

  async search(query: string, maxResults = 5): Promise<ResearchSearchResult[]> {
    const apiKey = this.configService.get<string>("TAVILY_API_KEY");
    if (!apiKey) {
      throw new ServiceUnavailableException("TAVILY_API_KEY is not configured");
    }

    const response = await fetch(`${this.baseUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: Math.max(1, Math.min(maxResults, 10)),
        search_depth: "advanced",
        include_answer: false,
        include_images: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`TAVILY_HTTP_${response.status}`);
    }

    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        score?: number;
      }>;
    };

    const results = Array.isArray(data.results) ? data.results : [];

    return results
      .filter((item) => item.url)
      .map((item) => ({
        title: (item.title ?? "Untitled").trim() || "Untitled",
        url: item.url!,
        snippet: (item.content ?? "").trim(),
        score: typeof item.score === "number" ? item.score : undefined,
      }));
  }
}
