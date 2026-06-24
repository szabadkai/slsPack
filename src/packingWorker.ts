import {
  simulateDropInTimeline,
  simulatePackingTimeline,
  simulateShakeTimeline,
} from './packing';
import type { JobSettings, ModelPart, PackingSimulation } from './types';

type WorkerSettings = Pick<JobSettings, 'seed' | 'cageEnabled' | 'printer'>;

type PackingWorkerRequest =
  | {
      jobId: number;
      kind: 'pack';
      models: ModelPart[];
      settings: WorkerSettings;
    }
  | {
      jobId: number;
      kind: 'shake';
      models: ModelPart[];
      settings: WorkerSettings;
    }
  | {
      jobId: number;
      kind: 'dropIn';
      existingModels: ModelPart[];
      addedModels: ModelPart[];
      settings: WorkerSettings;
    };

type PackingWorkerResponse =
  | {
      jobId: number;
      simulation: PackingSimulation;
    }
  | {
      jobId: number;
      error: string;
    };

self.onmessage = (event: MessageEvent<PackingWorkerRequest>) => {
  const request = event.data;
  try {
    const simulation =
      request.kind === 'pack'
        ? simulatePackingTimeline(request.models, request.settings)
        : request.kind === 'shake'
          ? simulateShakeTimeline(request.models, request.settings)
          : simulateDropInTimeline(request.existingModels, request.addedModels, request.settings);

    self.postMessage({ jobId: request.jobId, simulation } satisfies PackingWorkerResponse);
  } catch (error) {
    self.postMessage({
      jobId: request.jobId,
      error: error instanceof Error ? error.message : 'Packing simulation failed',
    } satisfies PackingWorkerResponse);
  }
};
