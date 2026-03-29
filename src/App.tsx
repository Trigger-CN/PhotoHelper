import { useEffect, useMemo, useState } from "react"
import { App as AntdApp, Button, Card, ConfigProvider, Empty, Input, message, Progress, Space, Spin, Switch, Tabs, Tag, Typography } from "antd"
import { List } from "react-window"
import { motion } from "framer-motion"

type FilterKey = "all" | "raw" | "jpeg"

const RAW_EXTS = new Set([".dng", ".arw", ".nef", ".nrw", ".cr2", ".cr3", ".raf", ".rw2", ".orf"])
const JPEG_EXTS = new Set([".jpg", ".jpeg"])

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

interface FileRowCustomProps {
  items: PhotoFile[]
  selectedSet: Set<string>
  selectedFileId?: string
  onSelect: (item: PhotoFile) => void
  onToggleSelect: (id: string) => void
}

function FileRow({ index, style, items, selectedSet, selectedFileId, onSelect, onToggleSelect }: FileRowCustomProps & { ariaAttributes: object; index: number; style: React.CSSProperties }) {
  const item = items[index]
  if (!item) return null
  const checked = selectedSet.has(item.id)
  const current = selectedFileId === item.id

  return (
    <div
      style={style}
      className={`file-item ${current ? "active" : ""}`}
      onClick={() => onSelect(item)}
    >
      <div className="file-item-content">
        <div className="file-item-title">
          <Space>
            <Typography.Text ellipsis className="file-name">
              {item.name}
            </Typography.Text>
            {RAW_EXTS.has(item.ext) ? <Tag color="gold">RAW</Tag> : <Tag color="blue">IMG</Tag>}
          </Space>
        </div>
        <div className="file-item-desc">
          {`${formatSize(item.size)} · ${new Date(item.mtimeMs).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`}
        </div>
      </div>
      <Button
        size="small"
        type={checked ? "primary" : "default"}
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect(item.id)
        }}
      >
        {checked ? "✓ 已选" : "选择"}
      </Button>
    </div>
  )
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error("timeout")), timeoutMs)
    })
  ])
}

function displayOrNone(value: string | null | undefined) {
  if (!value || value.trim().length === 0) return "none"
  return value
}

function AppContent() {
  const [api, contextHolder] = message.useMessage()
  const [sourceDir, setSourceDir] = useState<string>("")
  const [targetDir, setTargetDir] = useState<string>("")
  const [files, setFiles] = useState<PhotoFile[]>([])
  const [activeTab, setActiveTab] = useState<FilterKey>("all")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<PhotoFile | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<string>("none")
  const [photoInfo, setPhotoInfo] = useState<PhotoInfo | null>(null)
  const [isInfoLoading, setIsInfoLoading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [autoCreateByDate, setAutoCreateByDate] = useState(false)
  const [dateFolderNaming, setDateFolderNaming] = useState("{date}")
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [copyTaskId, setCopyTaskId] = useState<string>("")
  const [copyProcessed, setCopyProcessed] = useState(0)
  const [copyTotal, setCopyTotal] = useState(0)
  const [copyCurrentFile, setCopyCurrentFile] = useState("")
  const [rawResolution, setRawResolution] = useState<string | null>(null)

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      const config = await window.photoApi.loadConfig()
      setSourceDir(config.sourceDir || "")
      setTargetDir(config.targetDir || "")
      setAutoCreateByDate(config.autoCreateByDate || false)
      setDateFolderNaming(config.dateFolderNaming || "{date}")
      setSkipDuplicates(config.skipDuplicates !== false)
    }
    void loadConfig()
  }, [])

  const filteredFiles = useMemo(() => {
    if (activeTab === "raw") return files.filter((item) => item.isRaw)
    if (activeTab === "jpeg") return files.filter((item) => JPEG_EXTS.has(item.ext))
    return files
  }, [activeTab, files])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  async function chooseSourceDir() {
    const dir = await window.photoApi.selectDirectory("选择 SD 卡目录")
    if (!dir) return
    setSourceDir(dir)
    await window.photoApi.saveConfig({ sourceDir: dir, targetDir, autoCreateByDate, dateFolderNaming, skipDuplicates })
  }

  async function chooseTargetDir() {
    const dir = await window.photoApi.selectDirectory("选择目标目录")
    if (!dir) return
    setTargetDir(dir)
    await window.photoApi.saveConfig({ sourceDir, targetDir: dir, autoCreateByDate, dateFolderNaming, skipDuplicates })
  }

  async function refreshFiles(dir: string) {
    setIsScanning(true)
    setSelectedIds([])
    setSelectedFile(null)
    setPreviewSrc(null)
    setPreviewMode("none")
    setPhotoInfo(null)
    setRawResolution(null)
    const found = await window.photoApi.scanDirectory(dir)
    setFiles(found)
    setIsScanning(false)
    if (found.length > 0) {
      setSelectedFile(found[0])
    }
  }

  useEffect(() => {
    if (!sourceDir) return
    void refreshFiles(sourceDir)
  }, [sourceDir])

  useEffect(() => {
    if (!selectedFile) {
      setPreviewSrc(null)
      setPreviewMode("none")
      setRawResolution(null)
      return
    }

    let active = true
    const run = async () => {
      setIsPreviewLoading(true)
      let resolvedSrc: string | null = null
      let resolvedMode = "raw-error"
      try {
        const result = await withTimeout(window.photoApi.getPreview(selectedFile.path), 8000)
        if (!active) return
        resolvedSrc = result.src
        resolvedMode = result.mode

        // If no preview from main process and it's a RAW file, try dcraw-wasm via preload
        if (!resolvedSrc && selectedFile.isRaw) {
          try {
            const decoded = await withTimeout(window.photoApi.decodeRawPreview(selectedFile.path), 30000)
            if (!active) return
            if (decoded && decoded.dataUrl) {
              resolvedSrc = decoded.dataUrl
              resolvedMode = "raw-dcraw-decoded"
              if (active && decoded.width > 0 && decoded.height > 0) {
                setRawResolution(`${decoded.width} × ${decoded.height}`)
              }
            }
          } catch (err) {
            console.error("[Preview] decodeRawPreview error:", err)
          }
        }
      } catch (err) {
        resolvedSrc = null
        resolvedMode = selectedFile.isRaw ? "raw-wasm-error" : "file-error"
      } finally {
        if (active) {
          setPreviewSrc(resolvedSrc)
          setPreviewMode(resolvedMode)
          setIsPreviewLoading(false)
        }
      }
    }
    void run()
    return () => {
      active = false
    }
  }, [selectedFile])

  useEffect(() => {
    if (!selectedFile) {
      setPhotoInfo(null)
      return
    }
    let active = true
    const run = async () => {
      setIsInfoLoading(true)
      try {
        const info = await withTimeout(window.photoApi.getPhotoInfo(selectedFile.path), 8000)
        if (active) {
          setPhotoInfo(info)
        }
      } catch {
        if (active) {
          setPhotoInfo(null)
        }
      } finally {
        if (active) {
          setIsInfoLoading(false)
        }
      }
    }
    void run()
    return () => {
      active = false
    }
  }, [selectedFile])

  // libraw-wasm removed - it cannot decode this NEF format
  // Resolution info comes from main process via getPhotoInfo instead

  useEffect(() => {
    const off = window.photoApi.onCopyProgress((data) => {
      if (!data || !data.taskId || data.taskId !== copyTaskId) return
      setCopyProcessed(data.processed)
      setCopyTotal(data.total)
      setCopyCurrentFile(data.currentFile)
    })
    return () => off()
  }, [copyTaskId])

  async function doCopy(copyAll: boolean) {
    if (!targetDir) {
      api.warning("请先选择目标目录")
      return
    }
    const candidate = copyAll ? filteredFiles.map((item) => item.path) : filteredFiles.filter((item) => selectedSet.has(item.id)).map((item) => item.path)
    if (candidate.length === 0) {
      api.warning(copyAll ? "当前筛选下没有可复制文件" : "请先选择要复制的文件")
      return
    }
    const taskId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setCopyTaskId(taskId)
    setCopyProcessed(0)
    setCopyTotal(candidate.length)
    setCopyCurrentFile(candidate.length > 0 ? candidate[0].split(/[/\\]/).pop() || "" : "")
    setIsCopying(true)
    const result = await window.photoApi.copyFiles({
      filePaths: candidate,
      targetDir,
      options: { autoCreateByDate, dateFolderNaming, skipDuplicates },
      taskId
    })
    setIsCopying(false)
    setCopyProcessed(candidate.length)
    const copied = result.copied.length
    const skipped = result.skipped.length
    const failed = result.failed.length
    if (failed === 0 && skipped === 0) {
      api.success(`复制完成，共 ${copied} 个文件`)
    } else if (failed === 0) {
      api.success(`复制完成，${copied} 个已复制，${skipped} 个已跳过`)
    } else {
      api.warning(`完成 ${copied} 个，跳过 ${skipped} 个，失败 ${failed} 个`)
    }
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#6f7cff",
          colorBgBase: "#0b0d12",
          colorTextBase: "#edf1ff",
          borderRadius: 10
        }
      }}
    >
      {contextHolder}
      <div className="page">
        <motion.div className="shell" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <div className="top-row">
            <div className="path-block">
              <Typography.Text className="label">图片来源</Typography.Text>
              <Space.Compact style={{ width: "100%" }}>
                <Input value={sourceDir} readOnly placeholder="请选择 SD 卡目录" />
                <Button onClick={chooseSourceDir}>选择</Button>
              </Space.Compact>
            </div>
            <div className="path-block">
              <Typography.Text className="label">目标位置</Typography.Text>
              <Space.Compact style={{ width: "100%" }}>
                <Input value={targetDir} readOnly placeholder="请选择目标目录" />
                <Button onClick={chooseTargetDir}>选择</Button>
              </Space.Compact>
            </div>
          </div>

          <div className="content-row">
            <Card className="left-panel" bordered={false}>
              <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as FilterKey)}
                items={[
                  { key: "all", label: `全部 ${files.length}` },
                  { key: "raw", label: `RAW ${files.filter((f) => f.isRaw).length}` },
                  { key: "jpeg", label: `JPEG ${files.filter((f) => JPEG_EXTS.has(f.ext)).length}` }
                ]}
              />
              <div className="list-toolbar">
                <Button type="link" onClick={() => setSelectedIds(filteredFiles.map((item) => item.id))}>
                  全选
                </Button>
                <Button type="link" onClick={() => setSelectedIds([])}>
                  取消
                </Button>
                <Button type="link" onClick={() => sourceDir && void refreshFiles(sourceDir)}>
                  刷新
                </Button>
              </div>
              <div className="list-wrap">
                {isScanning ? (
                  <div className="center">
                    <Spin />
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <div className="center">
                    <Empty description="暂无照片" />
                  </div>
                ) : (
                  <List<FileRowCustomProps>
                    rowComponent={FileRow}
                    rowCount={filteredFiles.length}
                    rowHeight={72}
                    rowProps={{
                      items: filteredFiles,
                      selectedSet,
                      selectedFileId: selectedFile?.id,
                      onSelect: setSelectedFile,
                      onToggleSelect: (id: string) => {
                        setSelectedIds((prev) => {
                          if (prev.includes(id)) return prev.filter((i) => i !== id)
                          return [...prev, id]
                        })
                      }
                    }}
                    style={{ height: 600, width: "100%" }}
                  />
                )}
              </div>
            </Card>

            <Card className="right-panel" bordered={false}>
              <div className="preview-title">预览</div>
              <motion.div className="preview-box" key={selectedFile?.id ?? "empty"} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.24 }}>
                {isPreviewLoading ? (
                  <div className="preview-skeleton">
                    <div className="skeleton-icon" />
                  </div>
                ) : previewSrc ? (
                  <img src={previewSrc} alt={selectedFile?.name} className="preview-img" />
                ) : (
                  <div className="center muted">
                    {previewMode === "raw-empty" || previewMode === "raw-error"
                      ? "RAW 文件无嵌入预览图"
                      : previewMode === "raw-wasm-error"
                        ? "RAW 解码失败"
                      : previewMode === "file-error"
                        ? "图片暂时无法读取"
                      : "请选择照片"}
                  </div>
                )}
              </motion.div>

              <div className="info-panel">
                {isInfoLoading ? (
                  <div className="info-skeleton">
                    <div className="skeleton-line" />
                    <div className="skeleton-line short" />
                    <div className="skeleton-line" />
                    <div className="skeleton-line short" />
                  </div>
                ) : (
                  <div className="info-grid">
                    <div className="info-item">文件名：{displayOrNone(selectedFile?.name)}</div>
                    <div className="info-item">拍摄时间：{displayOrNone(photoInfo?.captureTime)}</div>
                    <div className="info-item">分辨率：{rawResolution || displayOrNone(photoInfo?.resolution)}</div>
                    <div className="info-item">快门：{displayOrNone(photoInfo?.exposureTime)}</div>
                    <div className="info-item">光圈：{displayOrNone(photoInfo?.fNumber)}</div>
                    <div className="info-item">ISO：{displayOrNone(photoInfo?.iso)}</div>
                    <div className="info-item">焦距：{displayOrNone(photoInfo?.focalLength)}</div>
                    <div className="info-item">镜头：{displayOrNone(photoInfo?.lensModel)}</div>
                    <div className="info-item">相机品牌：{displayOrNone(photoInfo?.cameraMake)}</div>
                    <div className="info-item">相机型号：{displayOrNone(photoInfo?.cameraModel)}</div>
                  </div>
                )}
              </div>

              <div className="copy-options">
                <Space align="center" wrap>
                  <Typography.Text className="muted">按日期分目录</Typography.Text>
                  <Switch checked={autoCreateByDate} onChange={(checked) => {
                    setAutoCreateByDate(checked)
                    void window.photoApi.saveConfig({ sourceDir, targetDir, autoCreateByDate: checked, dateFolderNaming, skipDuplicates })
                  }} />
                  <Typography.Text className="muted">目录格式</Typography.Text>
                  <Input
                    value={dateFolderNaming}
                    onChange={(event) => {
                      setDateFolderNaming(event.target.value)
                      void window.photoApi.saveConfig({ sourceDir, targetDir, autoCreateByDate, dateFolderNaming: event.target.value, skipDuplicates })
                    }}
                    placeholder="{date}"
                    style={{ width: 220 }}
                    disabled={!autoCreateByDate}
                  />
                  <Typography.Text className="muted">重复文件</Typography.Text>
                  <Switch checked={skipDuplicates} onChange={(checked) => {
                    setSkipDuplicates(checked)
                    void window.photoApi.saveConfig({ sourceDir, targetDir, autoCreateByDate, dateFolderNaming, skipDuplicates: checked })
                  }} />
                  <Typography.Text className="muted">{skipDuplicates ? "跳过" : "重命名"}</Typography.Text>
                </Space>
                <Typography.Text className="muted">使用 {'{date}'} 表示拍摄日期，例如 {"{date}"} → 2024-01-15</Typography.Text>
              </div>

              <Space className="actions">
                <Button type="primary" size="large" loading={isCopying} onClick={() => void doCopy(true)}>
                  复制全部
                </Button>
                <Button size="large" loading={isCopying} onClick={() => void doCopy(false)}>
                  复制所选
                </Button>
                <Typography.Text className="muted">已选 {selectedIds.length} 张</Typography.Text>
              </Space>
              {(isCopying || copyTotal > 0) && (
                <div className="copy-progress">
                  <Progress
                    percent={copyTotal > 0 ? Math.round((copyProcessed / copyTotal) * 100) : 0}
                    status={isCopying ? "active" : "success"}
                    showInfo
                  />
                  <Typography.Text className="muted">
                    正在复制：{copyCurrentFile || "无"}（{copyProcessed}/{copyTotal || 0}）
                  </Typography.Text>
                </div>
              )}
            </Card>
          </div>
        </motion.div>
      </div>
    </ConfigProvider>
  )
}

export default function App() {
  return (
    <AntdApp>
      <AppContent />
    </AntdApp>
  )
}
