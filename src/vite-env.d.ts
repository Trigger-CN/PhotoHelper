/// <reference types="vite/client" />

type PhotoFile = {
  id: string
  name: string
  ext: string
  path: string
  size: number
  mtimeMs: number
  isRaw: boolean
}

type CopyResult = {
  copied: Array<{ source: string; target: string }>
  skipped: Array<{ source: string; target: string }>
  failed: Array<{ source: string; reason: string }>
}

type CopyOptions = {
  autoCreateByDate: boolean
  dateFolderNaming: string
  skipDuplicates: boolean
}

type CopyProgress = {
  taskId: string | null
  currentFile: string
  processed: number
  total: number
}

type PhotoInfo = {
  fileName: string | null
  captureTime: string | null
  resolution: string | null
  exposureTime: string | null
  fNumber: string | null
  iso: string | null
  focalLength: string | null
  lensModel: string | null
  cameraMake: string | null
  cameraModel: string | null
}

type AppConfig = {
  sourceDir: string
  targetDir: string
  autoCreateByDate: boolean
  dateFolderNaming: string
  skipDuplicates: boolean
}

interface Window {
  photoApi: {
    selectDirectory: (title?: string) => Promise<string | null>
    scanDirectory: (dirPath: string | null) => Promise<PhotoFile[]>
    getPreview: (filePath: string) => Promise<{ src: string | null; mode: string }>
    getPhotoInfo: (filePath: string) => Promise<PhotoInfo | null>
    copyFiles: (payload: { filePaths: string[]; targetDir: string; options?: CopyOptions; taskId?: string }) => Promise<CopyResult>
    onCopyProgress: (listener: (data: CopyProgress) => void) => () => void
    readFileBuffer: (filePath: string) => Promise<Uint8Array | null>
    savePreviewCache: (payload: { sourcePath: string; dataUrl: string }) => Promise<string | null>
    decodeRawPreview: (filePath: string) => Promise<{ dataUrl: string; width: number; height: number } | null>
    loadConfig: () => Promise<AppConfig>
    saveConfig: (config: Partial<AppConfig>) => Promise<boolean>
  }
}

declare module "libraw-wasm" {
  const LibRaw: new () => {
    open: (fileBytes: Uint8Array, options?: Record<string, unknown>) => Promise<unknown>
    metadata: (decodeThumb?: boolean) => Promise<Record<string, unknown> | null>
    imageData: () => Promise<unknown>
  }
  export default LibRaw
}
