export interface Project {
  id: string;
  name: string;
  href: string;
  blurb: string;
  tags: string[];
}

// Copy a block to add a project.
export const projects: Project[] = [
  {
    id: 'pylon',
    name: 'Pylon',
    href: 'https://github.com/raun6k/Pylon',
    blurb:
      "A single-GPU inference server for Qwen3-4B-Instruct-2507. CUDA-graph decode raised output speed from 24.8 to 26.2 tokens/s at one request, and from 176.0 to 184.9 at eight, against this server's own eager path.",
    tags: ['Python', 'PyTorch', 'CUDA'],
  },
  {
    id: 'tracelens',
    name: 'TraceLens',
    href: 'https://github.com/raun6k/TraceLens',
    blurb:
      'Reads OpenTelemetry traces from a service chain and names the slow span. An isolation forest flags it, and an injected slow query makes the finding reproducible.',
    tags: ['Python', 'FastAPI', 'OpenTelemetry', 'Jaeger', 'scikit-learn', 'Docker'],
  },
];
