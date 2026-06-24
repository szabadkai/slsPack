import { createImportedParts } from './importers';
import type { BuildVolume, ModelPart } from './types';

type ImportWorkerRequest = {
  jobId: number;
  files: File[];
  startIndex: number;
  buildVolume: BuildVolume;
};

type ImportWorkerResponse =
  | {
      jobId: number;
      imported: ModelPart[];
    }
  | {
      jobId: number;
      error: string;
    };

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<ImportWorkerRequest>) => void) | null;
  postMessage: (message: ImportWorkerResponse, transfer?: Transferable[]) => void;
};

function collectTransfers(models: ModelPart[]) {
  const transfers: Transferable[] = [];

  models.forEach((model) => {
    const mesh = model.customMesh;
    if (!mesh) return;
    transfers.push(mesh.positions.buffer as ArrayBuffer);
    if (mesh.normals) transfers.push(mesh.normals.buffer as ArrayBuffer);
    if (mesh.indices) transfers.push(mesh.indices.buffer as ArrayBuffer);
  });

  return transfers;
}

workerSelf.onmessage = (event: MessageEvent<ImportWorkerRequest>) => {
  const request = event.data;

  void createImportedParts(request.files, request.startIndex, request.buildVolume)
    .then((imported) => {
      workerSelf.postMessage({ jobId: request.jobId, imported } satisfies ImportWorkerResponse, collectTransfers(imported));
    })
    .catch((error) => {
      workerSelf.postMessage({
        jobId: request.jobId,
        error: error instanceof Error ? error.message : 'Could not import model',
      } satisfies ImportWorkerResponse);
    });
};
