const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require("electron")
const path = require("node:path")
const fs = require("node:fs/promises")
const { constants } = require("node:fs")
const { createHash } = require("node:crypto")
const { pathToFileURL } = require("node:url")
const exifr = require("exifr")

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".webp",
  ".heic",
  ".heif",
  ".dng",
  ".arw",
  ".nef",
  ".nrw",
  ".cr2",
  ".cr3",
  ".raf",
  ".rw2",
  ".orf"
])

const RAW_EXTENSIONS = new Set([".dng", ".arw", ".nef", ".nrw", ".cr2", ".cr3", ".raf", ".rw2", ".orf"])

const isDev = !app.isPackaged

function createWindow() {
  const window = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    title: "PhotoHelper",
    backgroundColor: "#0a0b10",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (isDev) {
    window.loadURL("http://localhost:5173")
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"))
  }
}

async function collectFiles(rootDir) {
  const result = []
  const queue = [rootDir]

  while (queue.length > 0) {
    const currentDir = queue.shift()
    const entries = await fs.readdir(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        queue.push(absolutePath)
        continue
      }
      if (!entry.isFile()) {
        continue
      }

      const ext = path.extname(entry.name).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(ext)) {
        continue
      }

      const stats = await fs.stat(absolutePath)
      result.push({
        id: absolutePath,
        name: entry.name,
        ext,
        path: absolutePath,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        isRaw: RAW_EXTENSIONS.has(ext)
      })
    }
  }

  return result.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function toBase64DataUrl(buffer, mimeType = "image/jpeg") {
  const rawBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  return `data:${mimeType};base64,${rawBuffer.toString("base64")}`
}

function getMimeType(ext) {
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".png") return "image/png"
  if (ext === ".gif") return "image/gif"
  if (ext === ".bmp") return "image/bmp"
  if (ext === ".webp") return "image/webp"
  if (ext === ".tif" || ext === ".tiff") return "image/tiff"
  if (ext === ".heic") return "image/heic"
  if (ext === ".heif") return "image/heif"
  return "application/octet-stream"
}

async function existsFile(filePath) {
  try {
    await fs.access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readImageAsDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const imageBuffer = await fs.readFile(filePath)
  return toBase64DataUrl(imageBuffer, getMimeType(ext))
}

async function findCompanionJpeg(filePath) {
  const parsed = path.parse(filePath)
  const jpg = path.join(parsed.dir, `${parsed.name}.jpg`)
  const jpeg = path.join(parsed.dir, `${parsed.name}.jpeg`)
  if (await existsFile(jpg)) return jpg
  if (await existsFile(jpeg)) return jpeg
  return null
}

async function createUniqueTargetPath(targetDir, fileName) {
  const parsed = path.parse(fileName)
  let index = 0
  let candidate = path.join(targetDir, fileName)
  while (true) {
    try {
      await fs.access(candidate, constants.F_OK)
      index += 1
      candidate = path.join(targetDir, `${parsed.name}(${index})${parsed.ext}`)
    } catch {
      return candidate
    }
  }
}

async function ensurePreviewCacheDir() {
  const cacheDir = path.join(app.getPath("userData"), "preview-cache")
  await fs.mkdir(cacheDir, { recursive: true })
  return cacheDir
}

function makePreviewCacheName(sourcePath, size, mtimeMs) {
  const key = `${sourcePath}|${size}|${mtimeMs}`
  return `${createHash("sha1").update(key).digest("hex")}.jpg`
}

function asDisplayValue(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (Array.isArray(value)) {
    const text = value.map((item) => asDisplayValue(item)).filter(Boolean).join(", ")
    return text || null
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    return String(value)
  }
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function formatExposureTime(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return asDisplayValue(value)
  }
  if (value >= 1) return `${value.toFixed(1)}s`
  const denominator = Math.round(1 / value)
  if (denominator > 0) return `1/${denominator}s`
  return `${value.toFixed(4)}s`
}

function toPositiveInt(value) {
  if (value === null || value === undefined) return null
  if (Array.isArray(value) && value.length > 0) {
    return toPositiveInt(value[0])
  }
  if (value && typeof value === "object") {
    const raw = value
    if ("value" in raw) {
      return toPositiveInt(raw.value)
    }
    if ("numerator" in raw && "denominator" in raw) {
      try {
        const numerator = Number(raw.numerator)
        const denominator = Number(raw.denominator)
        if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
          return toPositiveInt(numerator / denominator)
        }
      } catch {
        return null
      }
    }
    // Handle nested Rational/SRational
    if ("numerator" in raw) {
      return toPositiveInt(raw.numerator)
    }
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value)
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed)
  }
  return null
}

function shouldSwapByOrientation(orientation) {
  if (typeof orientation === "number") return orientation >= 5 && orientation <= 8
  if (typeof orientation === "string") {
    const text = orientation.toLowerCase()
    return text.includes("90") || text.includes("270")
  }
  return false
}

function formatResolution(exifData) {
  const imageWidth = toPositiveInt(exifData?.ImageWidth)
  const imageHeight = toPositiveInt(exifData?.ImageHeight)
  if (imageWidth && imageHeight) {
    return `${imageWidth} × ${imageHeight}`
  }

  const pairs = []
  const pushPair = (widthValue, heightValue) => {
    const width = toPositiveInt(widthValue)
    const height = toPositiveInt(heightValue)
    if (!width || !height) return
    if (width < 16 || height < 16) return
    pairs.push({ width, height, area: width * height })
  }

  pushPair(exifData?.PixelXDimension, exifData?.PixelYDimension)
  pushPair(exifData?.ExifImageWidth, exifData?.ExifImageHeight)
  pushPair(exifData?.RawImageWidth, exifData?.RawImageHeight)
  pushPair(exifData?.ValidImageSize?.[0], exifData?.ValidImageSize?.[1])
  pushPair(exifData?.SensorWidth, exifData?.SensorHeight)
  pushPair(exifData?.OriginalImageWidth, exifData?.OriginalImageHeight)
  pushPair(exifData?.SourceImageWidth, exifData?.SourceImageHeight)
  // Additional tags that may exist in RAW files
  pushPair(exifData?.ImageImageWidth, exifData?.ImageImageHeight)
  pushPair(exifData?.ImageLength, exifData?.ImageWidth)
  pushPair(exifData?.JPEGImageWidth, exifData?.JPEGImageHeight)
  pushPair(exifData?.JPEGInterchangeFormat, exifData?.JPEGInterchangeFormatLength)
  // DNG-specific
  if (Array.isArray(exifData?.DefaultCropSize) && exifData.DefaultCropSize.length >= 2) {
    pushPair(exifData.DefaultCropSize[0], exifData.DefaultCropSize[1])
  }
  if (Array.isArray(exifData?.DefaultCropSize)?.[0], exifData?.DefaultCropSize?.[1]) {
    pushPair(exifData.DefaultCropSize[0], exifData.DefaultCropSize[1])
  }
  if (pairs.length === 0) return null

  pairs.sort((a, b) => b.area - a.area)
  let { width, height } = pairs[0]
  if (shouldSwapByOrientation(exifData?.Orientation)) {
    ;[width, height] = [height, width]
  }
  return `${width} × ${height}`
}

function normalizeToDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date
  }
  return null
}

function formatDateKey(date) {
  const y = String(date.getFullYear()).padStart(4, "0")
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}.${m}.${d}`
}

function sanitizeFolderName(name) {
  const text = String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
  return text || "none"
}

function buildDateFolderName(naming, dateKey) {
  const base = (naming || "").trim()
  if (!base) return dateKey
  if (base.includes("{date}")) {
    return sanitizeFolderName(base.replaceAll("{date}", dateKey))
  }
  return sanitizeFolderName(`${base}-${dateKey}`)
}

async function getCaptureDateKey(filePath) {
  try {
    const exifData = await exifr.parse(filePath, { pick: ["DateTimeOriginal", "CreateDate", "DateTime"] })
    const date = normalizeToDate(exifData?.DateTimeOriginal || exifData?.CreateDate || exifData?.DateTime)
    if (date) return formatDateKey(date)
  } catch {}
  try {
    const stats = await fs.stat(filePath)
    return formatDateKey(stats.mtime)
  } catch {
    return "none"
  }
}

// Config file handling
const CONFIG_VERSION = 1

async function getConfigPath() {
  return path.join(app.getPath("userData"), "config.json")
}

ipcMain.handle("load-config", async () => {
  try {
    const configPath = await getConfigPath()
    const data = await fs.readFile(configPath, "utf-8")
    const parsed = JSON.parse(data)
    if (parsed.version !== CONFIG_VERSION) {
      return { sourceDir: "", targetDir: "", autoCreateByDate: false, dateFolderNaming: "{date}", skipDuplicates: true }
    }
    return {
      sourceDir: parsed.sourceDir || "",
      targetDir: parsed.targetDir || "",
      autoCreateByDate: parsed.autoCreateByDate || false,
      dateFolderNaming: parsed.dateFolderNaming || "{date}",
      skipDuplicates: parsed.skipDuplicates !== false
    }
  } catch {
    return { sourceDir: "", targetDir: "", autoCreateByDate: false, dateFolderNaming: "{date}", skipDuplicates: true }
  }
})

ipcMain.handle("save-config", async (_, config) => {
  try {
    const configPath = await getConfigPath()
    await fs.writeFile(configPath, JSON.stringify({ version: CONFIG_VERSION, ...config }, null, 2), "utf-8")
    return true
  } catch (e) {
    console.error("[save-config]", e)
    return false
  }
})

ipcMain.handle("select-directory", async (_, title) => {
  const selected = await dialog.showOpenDialog({
    title: title || "选择目录",
    properties: ["openDirectory", "createDirectory"]
  })
  if (selected.canceled || selected.filePaths.length === 0) {
    return null
  }
  return selected.filePaths[0]
})

ipcMain.handle("scan-directory", async (_, dirPath) => {
  if (!dirPath) {
    return []
  }
  try {
    return await collectFiles(dirPath)
  } catch {
    return []
  }
})

ipcMain.handle("get-preview", async (_, filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  if (!RAW_EXTENSIONS.has(ext)) {
    try {
      return { src: await readImageAsDataUrl(filePath), mode: "file-data-url" }
    } catch {
      return { src: null, mode: "file-error" }
    }
  }

  try {
    // Try exifr.thumbnail() first
    try {
      const thumbnail = await exifr.thumbnail(filePath)
      if (thumbnail) {
        return { src: toBase64DataUrl(thumbnail), mode: "raw-thumbnail" }
      }
    } catch {}

    // Try full exifr.parse
    try {
      const fullData = await exifr.parse(filePath)
      if (fullData?.ThumbnailImage) {
        return { src: toBase64DataUrl(fullData.ThumbnailImage), mode: "raw-thumbnail" }
      }
      if (fullData?.PreviewImage) {
        return { src: toBase64DataUrl(fullData.PreviewImage), mode: "raw-preview" }
      }
    } catch {}

    const companionJpegPath = await findCompanionJpeg(filePath)
    if (companionJpegPath) {
      return { src: await readImageAsDataUrl(companionJpegPath), mode: "raw-companion-jpeg" }
    }

    // Try nativeImage
    try {
      const osThumbnail = await nativeImage.createThumbnailFromPath(filePath, { width: 1600, height: 1200 })
      if (!osThumbnail.isEmpty()) {
        return { src: osThumbnail.toDataURL(), mode: "raw-os-thumbnail" }
      }
    } catch {}

    return { src: null, mode: "raw-empty" }
  } catch (e) {
    return { src: null, mode: "raw-error" }
  }
})

ipcMain.handle("copy-files", async (event, payload) => {
  const { filePaths = [], targetDir, options = {}, taskId = null } = payload || {}
  const { autoCreateByDate = false, dateFolderNaming = "{date}", skipDuplicates = true } = options
  if (!targetDir || filePaths.length === 0) {
    return { copied: [], skipped: [], failed: [] }
  }

  await fs.mkdir(targetDir, { recursive: true })
  const copied = []
  const skipped = []
  const failed = []

  const total = filePaths.length
  let processed = 0

  for (const source of filePaths) {
    try {
      let destinationDir = targetDir
      if (autoCreateByDate) {
        const dateKey = await getCaptureDateKey(source)
        const folderName = buildDateFolderName(dateFolderNaming, dateKey)
        destinationDir = path.join(targetDir, folderName)
      }
      await fs.mkdir(destinationDir, { recursive: true })
      const baseName = path.basename(source)
      const targetPath = path.join(destinationDir, baseName)

      // Check if file already exists at target path
      if (await existsFile(targetPath)) {
        if (skipDuplicates) {
          skipped.push({ source, target: targetPath })
          processed += 1
          event.sender.send("copy-progress", {
            taskId,
            currentFile: baseName,
            processed,
            total
          })
          continue
        } else {
          // Rename with (1), (2), etc. without space
          const finalPath = await createUniqueTargetPath(destinationDir, baseName)
          await fs.copyFile(source, finalPath)
          copied.push({ source, target: finalPath })
        }
      } else {
        await fs.copyFile(source, targetPath)
        copied.push({ source, target: targetPath })
      }
    } catch (error) {
      failed.push({ source, reason: String(error) })
    } finally {
      processed += 1
      event.sender.send("copy-progress", {
        taskId,
        currentFile: path.basename(source),
        processed,
        total
      })
    }
  }

  return { copied, skipped, failed }
})

ipcMain.handle("read-file-buffer", async (_, filePath) => {
  try {
    const fileBuffer = await fs.readFile(filePath)
    return new Uint8Array(fileBuffer)
  } catch {
    return null
  }
})

ipcMain.handle("save-preview-cache", async (_, payload) => {
  const { sourcePath, dataUrl } = payload || {}
  if (!sourcePath || !dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return null
  }
  try {
    const [meta, base64] = dataUrl.split(",", 2)
    if (!base64 || !meta.includes(";base64")) {
      return null
    }
    const stats = await fs.stat(sourcePath)
    const cacheDir = await ensurePreviewCacheDir()
    const fileName = makePreviewCacheName(sourcePath, stats.size, stats.mtimeMs)
    const cachePath = path.join(cacheDir, fileName)
    await fs.writeFile(cachePath, Buffer.from(base64, "base64"))
    return pathToFileURL(cachePath).toString()
  } catch {
    return null
  }
})

ipcMain.handle("get-photo-info", async (_, filePath) => {
  if (!filePath) return null
  try {
    const exifData = await exifr.parse(filePath, {
      tiff: true,
      exif: true,
      ifd0: true,
      xmp: true,
      icc: false,
      iptc: false,
      jfif: false,
      makerNote: false,
      translateValues: true,
      reviveValues: true
    })

    return {
      fileName: path.basename(filePath),
      captureTime: asDisplayValue(exifData?.DateTimeOriginal || exifData?.CreateDate || exifData?.DateTime),
      resolution: asDisplayValue(formatResolution(exifData)),
      exposureTime: formatExposureTime(exifData?.ExposureTime),
      fNumber: asDisplayValue(exifData?.FNumber ? `f/${exifData.FNumber}` : null),
      iso: asDisplayValue(exifData?.ISO),
      focalLength: asDisplayValue(exifData?.FocalLength ? `${exifData.FocalLength}mm` : null),
      lensModel: asDisplayValue(exifData?.LensModel || exifData?.Lens),
      cameraMake: asDisplayValue(exifData?.Make),
      cameraModel: asDisplayValue(exifData?.Model)
    }
  } catch {
    return {
      fileName: path.basename(filePath),
      captureTime: null,
      resolution: null,
      exposureTime: null,
      fNumber: null,
      iso: null,
      focalLength: null,
      lensModel: null,
      cameraMake: null,
      cameraModel: null
    }
  }
})

// dcraw-wasm decoder for RAW files (runs in main process to avoid sandbox issues)
let dcrawDecoder = null

async function getDcrawDecoder() {
  if (!dcrawDecoder) {
    const { RawDecoder } = await import("dcraw-wasm")
    dcrawDecoder = new RawDecoder()
    await dcrawDecoder.init()
  }
  return dcrawDecoder
}

ipcMain.handle("decode-raw-preview", async (_, filePath) => {
  if (!filePath) return null
  try {
    const decoder = await getDcrawDecoder()
    const fileBuffer = await fs.readFile(filePath)
    const uint8Array = new Uint8Array(fileBuffer)

    const thumbnail = await decoder.extractThumbnail(uint8Array)
    if (!thumbnail || thumbnail.length === 0) {
      return null
    }

    const base64 = Buffer.from(thumbnail).toString("base64")
    const dataUrl = `data:image/jpeg;base64,${base64}`

    const metadata = await decoder.readMetadata(uint8Array)
    let width = 0
    let height = 0
    const fullSize = metadata?.propertyMap?.["image.fullSize"]
    if (fullSize && typeof fullSize.value === "string") {
      const match = fullSize.value.match(/(\d+)\s*[xX×]\s*(\d+)/)
      if (match) {
        width = parseInt(match[1], 10)
        height = parseInt(match[2], 10)
      }
    }

    return { dataUrl, width, height }
  } catch (e) {
    console.error("[decode-raw-preview]", e)
    return null
  }
})

app.whenReady().then(() => {
  const { Menu } = require("electron")
  Menu.setApplicationMenu(null)
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
