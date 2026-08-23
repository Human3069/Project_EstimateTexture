// cd "D:\Works\Complex\Project_EstimateTexture\Frontends"
// npm run dev

import './style.css'

const TextureType = {
  AlbedoMap: 0,
  HeightMap: 1,
  NormalMap: 2,
} as const

interface GenerateTexturesResponse {
  requestId: string
  heightMapUrl: string
  normalMapUrl: string
}

interface UnityInstance {
  SendMessage(gameObjectName: string, methodName: string, parameter?: string | number): void
  SetFullscreen(fullscreen: number): void
}

interface UnityConfig {
  arguments: string[]
  dataUrl: string
  frameworkUrl: string
  codeUrl: string
  streamingAssetsUrl: string
  companyName: string
  productName: string
  productVersion: string
  showBanner: (message: string, type: string) => void
}

interface UnityBuildManifest {
  loader: string
  data: string
  framework: string
  code: string
}

declare global {
  interface Window {
    createUnityInstance?: (
      canvas: HTMLCanvasElement,
      config: UnityConfig,
      onProgress: (progress: number) => void,
    ) => Promise<UnityInstance>
  }
}

const UNITY_ROOT = '/unity'
const BACKEND_API_ROOT = 'http://127.0.0.1:8000'
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_TEXTURE_DIMENSION = 4096

let unityInstance: UnityInstance | null = null
let albedoFile: File | null = null
let albedoObjectUrl: string | null = null
let hasPendingAlbedoChange = false
let heightMapUrl: string | null = null
let normalMapUrl: string | null = null
let generationSequence = 0

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="workspace">
    <header class="workspace-header">
      <div>
        <p class="eyebrow">AI TEXTURE WORKSPACE</p>
        <h1>Estimate Texture</h1>
      </div>
      <div class="connection-state" aria-live="polite">
        <span class="connection-dot" aria-hidden="true"></span>
        <span id="unity-state">Unity 연결 대기 중</span>
      </div>
    </header>

    <section class="panel-grid" aria-label="텍스처 및 3D 미리보기">
      <article class="panel texture-panel">
        <div class="panel-heading">
          <div><span class="panel-number">01</span><h2>Albedo Map</h2></div>
          <span id="albedo-status" class="texture-status">비어 있음</span>
        </div>
        <div class="preview-box">
          <img id="albedo-preview" alt="Albedo Map 미리보기" hidden />
          <span id="albedo-empty" class="empty-state">이미지가 없습니다.</span>
        </div>
        <div class="texture-actions">
          <label class="file-picker" for="albedo-input">텍스처 불러오기</label>
          <button id="albedo-remove" class="remove-button" type="button" disabled>텍스처 삭제</button>
        </div>
        <input id="albedo-input" type="file" accept="image/png,image/jpeg,image/webp" />
        <dl class="file-info">
          <div><dt>파일</dt><dd id="albedo-file-name">-</dd></div>
          <div><dt>크기</dt><dd id="albedo-file-size">-</dd></div>
        </dl>
      </article>

      ${createReadOnlyPanel('02', 'Height Map', 'height')}
      ${createReadOnlyPanel('03', 'Normal Map', 'normal')}

      <article class="panel unity-panel">
        <div class="panel-heading viewer-heading">
          <div><span class="panel-number">04</span><h2>3D Viewer</h2></div>
          <button id="fullscreen-button" class="icon-button" type="button" disabled>전체화면</button>
        </div>
        <div class="viewer-stage">
          <canvas id="unity-canvas" width="960" height="600" tabindex="-1"></canvas>
          <div id="unity-loading" class="unity-loading">
            <strong id="unity-loading-text">Unity WebGL 준비 중...</strong>
            <progress id="unity-progress" max="1" value="0"></progress>
          </div>
          <div id="unity-warning" class="unity-warning" hidden></div>
        </div>
      </article>
    </section>
  </main>
`

const unityState = requiredElement<HTMLElement>('#unity-state')
const connectionState = requiredElement<HTMLElement>('.connection-state')
const albedoInput = requiredElement<HTMLInputElement>('#albedo-input')
const albedoPreview = requiredElement<HTMLImageElement>('#albedo-preview')
const albedoEmpty = requiredElement<HTMLElement>('#albedo-empty')
const albedoStatus = requiredElement<HTMLElement>('#albedo-status')
const albedoFileName = requiredElement<HTMLElement>('#albedo-file-name')
const albedoFileSize = requiredElement<HTMLElement>('#albedo-file-size')
const albedoRemove = requiredElement<HTMLButtonElement>('#albedo-remove')
const heightPreview = requiredElement<HTMLImageElement>('#height-preview')
const heightEmpty = requiredElement<HTMLElement>('#height-empty')
const heightStatus = requiredElement<HTMLElement>('#height-status')
const normalPreview = requiredElement<HTMLImageElement>('#normal-preview')
const normalEmpty = requiredElement<HTMLElement>('#normal-empty')
const normalStatus = requiredElement<HTMLElement>('#normal-status')
const unityCanvas = requiredElement<HTMLCanvasElement>('#unity-canvas')
const unityLoading = requiredElement<HTMLElement>('#unity-loading')
const unityLoadingText = requiredElement<HTMLElement>('#unity-loading-text')
const unityProgress = requiredElement<HTMLProgressElement>('#unity-progress')
const unityWarning = requiredElement<HTMLElement>('#unity-warning')
const fullscreenButton = requiredElement<HTMLButtonElement>('#fullscreen-button')

albedoInput.addEventListener('change', () => void handleAlbedoChange())
albedoRemove.addEventListener('click', handleAlbedoRemove)
fullscreenButton.addEventListener('click', () => unityInstance?.SetFullscreen(1))
unityCanvas.addEventListener('pointerdown', () => unityCanvas.focus())

async function handleAlbedoChange(): Promise<void> {
  const file = albedoInput.files?.[0]
  if (file === undefined) return

  if (!file.type.startsWith('image/')) {
    console.warn('Albedo Map: 이미지 파일만 선택할 수 있습니다.')
    albedoInput.value = ''
    return
  }
  if (file.size > MAX_FILE_SIZE) {
    console.warn('Albedo Map: 10MB 이하의 이미지를 선택해 주세요.')
    albedoInput.value = ''
    return
  }

  try {
    await validateImageDimensions(file)
    revokeAlbedoObjectUrl()
    albedoFile = file
    albedoObjectUrl = URL.createObjectURL(file)
    hasPendingAlbedoChange = true
    updateAlbedoView()
    sendAlbedo()

    const currentSequence = ++generationSequence
    clearGeneratedTextures(true)
    setGeneratedStatus('생성 중')

    try {
      const result = await generateTextures(file)
      if (currentSequence !== generationSequence) return

      heightMapUrl = result.heightMapUrl
      normalMapUrl = result.normalMapUrl
      updateGeneratedTextureViews()
      sendTexture(heightMapUrl, TextureType.HeightMap)
      sendTexture(normalMapUrl, TextureType.NormalMap)
    } catch (error) {
      if (currentSequence !== generationSequence) return
      setGeneratedStatus('생성 실패')
      console.error('Height Map과 Normal Map 생성에 실패했습니다.', error)
    }
  } catch (error) {
    console.error('Albedo Map을 읽지 못했습니다.', error)
    albedoInput.value = ''
  }
}

function sendAlbedo(): void {
  if (unityInstance === null) {
    hasPendingAlbedoChange = true
    return
  }

  try {
    unityInstance.SendMessage('CubeHandler', 'ReceiveTexture', JSON.stringify({
      url: albedoObjectUrl,
      textureType: TextureType.AlbedoMap,
    }))
    hasPendingAlbedoChange = false
  } catch (error) {
    hasPendingAlbedoChange = true
    console.error('Albedo Map 적용에 실패했습니다.', error)
  }
}

function sendTexture(url: string | null, textureType: number): void {
  if (unityInstance === null) return

  try {
    unityInstance.SendMessage('CubeHandler', 'ReceiveTexture', JSON.stringify({
      url,
      textureType,
    }))
  } catch (error) {
    console.error(`TextureType ${textureType} 적용에 실패했습니다.`, error)
  }
}

async function generateTextures(file: File): Promise<GenerateTexturesResponse> {
  const formData = new FormData()
  formData.append('albedo', file)

  const response = await fetch(`${BACKEND_API_ROOT}/api/textures/generate`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(errorBody?.detail ?? `Backend 요청 실패: ${response.status}`)
  }

  return response.json() as Promise<GenerateTexturesResponse>
}

function handleAlbedoRemove(): void {
  generationSequence += 1
  clearAlbedo(true)
  clearGeneratedTextures(true)
  sendAlbedo()
}

function clearAlbedo(shouldSendNull: boolean): void {
  revokeAlbedoObjectUrl()
  albedoFile = null
  albedoInput.value = ''
  hasPendingAlbedoChange = shouldSendNull
  updateAlbedoView()
}

function updateAlbedoView(): void {
  const hasTexture = albedoObjectUrl !== null
  albedoPreview.src = albedoObjectUrl ?? ''
  albedoPreview.hidden = !hasTexture
  albedoEmpty.hidden = hasTexture
  albedoStatus.textContent = hasTexture ? '지정됨' : '비어 있음'
  albedoStatus.classList.toggle('ready', hasTexture)
  albedoFileName.textContent = albedoFile?.name ?? '-'
  albedoFileSize.textContent = albedoFile === null ? '-' : formatBytes(albedoFile.size)
  albedoRemove.disabled = !hasTexture
}

function revokeAlbedoObjectUrl(): void {
  if (albedoObjectUrl === null) return
  URL.revokeObjectURL(albedoObjectUrl)
  albedoObjectUrl = null
}

function clearGeneratedTextures(shouldSendNull: boolean): void {
  heightMapUrl = null
  normalMapUrl = null
  updateGeneratedTextureViews()

  if (shouldSendNull) {
    sendTexture(null, TextureType.HeightMap)
    sendTexture(null, TextureType.NormalMap)
  }
}

function updateGeneratedTextureViews(): void {
  updateGeneratedTextureView(heightPreview, heightEmpty, heightStatus, heightMapUrl)
  updateGeneratedTextureView(normalPreview, normalEmpty, normalStatus, normalMapUrl)
}

function updateGeneratedTextureView(
  preview: HTMLImageElement,
  empty: HTMLElement,
  status: HTMLElement,
  url: string | null,
): void {
  const hasTexture = url !== null
  preview.src = url ?? ''
  preview.hidden = !hasTexture
  empty.hidden = hasTexture
  empty.textContent = '생성된 이미지가 없습니다.'
  status.textContent = hasTexture ? '생성됨' : '대기 중'
  status.classList.toggle('ready', hasTexture)
}

function setGeneratedStatus(message: string): void {
  heightStatus.textContent = message
  normalStatus.textContent = message
  heightEmpty.textContent = message === '생성 중' ? '텍스처 로딩 중...' : message
  normalEmpty.textContent = message === '생성 중' ? '텍스처 로딩 중...' : message
  heightStatus.classList.remove('ready')
  normalStatus.classList.remove('ready')
}

async function validateImageDimensions(file: File): Promise<void> {
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width > MAX_TEXTURE_DIMENSION || bitmap.height > MAX_TEXTURE_DIMENSION) {
      throw new Error(`이미지 해상도는 ${MAX_TEXTURE_DIMENSION}x${MAX_TEXTURE_DIMENSION} 이하여야 합니다.`)
    }
  } finally {
    bitmap.close()
  }
}

async function loadUnity(): Promise<void> {
  try {
    const manifest = await loadManifest()
    const buildRoot = `${UNITY_ROOT}/Build`
    await loadScript(`${buildRoot}/${manifest.loader}`)
    if (window.createUnityInstance === undefined) throw new Error('Unity 로더를 초기화하지 못했습니다.')

    unityInstance = await window.createUnityInstance(unityCanvas, {
      arguments: [],
      dataUrl: `${buildRoot}/${manifest.data}`,
      frameworkUrl: `${buildRoot}/${manifest.framework}`,
      codeUrl: `${buildRoot}/${manifest.code}`,
      streamingAssetsUrl: `${UNITY_ROOT}/StreamingAssets`,
      companyName: 'DefaultCompany',
      productName: 'EstimateTexture_3DViewer',
      productVersion: '0.1.0',
      showBanner: showUnityBanner,
    }, (progress) => {
      unityProgress.value = progress
      unityLoadingText.textContent = `Unity WebGL 로딩 중... ${Math.round(progress * 100)}%`
    })

    unityLoading.hidden = true
    fullscreenButton.disabled = false
    unityState.textContent = 'Unity 연결됨'
    connectionState.classList.add('connected')
    if (hasPendingAlbedoChange) sendAlbedo()
    sendTexture(heightMapUrl, TextureType.HeightMap)
    sendTexture(normalMapUrl, TextureType.NormalMap)
  } catch (error) {
    console.error(error)
    unityLoadingText.textContent = 'Unity WebGL을 불러오지 못했습니다.'
    showUnityBanner(error instanceof Error ? error.message : String(error), 'error')
  }
}

async function loadManifest(): Promise<UnityBuildManifest> {
  const response = await fetch(`${UNITY_ROOT}/build-manifest.json`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Unity 빌드 정보 로드 실패: ${response.status}`)
  return response.json() as Promise<UnityBuildManifest>
}

function createReadOnlyPanel(number: string, title: string, key: string): string {
  return `<article class="panel texture-panel readonly-panel">
    <div class="panel-heading">
      <div><span class="panel-number">${number}</span><h2>${title}</h2></div>
      <span id="${key}-status" class="texture-status">대기 중</span>
    </div>
    <div class="preview-box" aria-live="polite">
      <img id="${key}-preview" alt="${title} 미리보기" hidden />
      <span id="${key}-empty" class="empty-state">생성된 이미지가 없습니다.</span>
    </div>
    <p class="readonly-note">생성 결과가 이 영역에 표시됩니다.</p>
  </article>`
}

function loadScript(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = source
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`스크립트 로드 실패: ${source}`))
    document.body.appendChild(script)
  })
}

function showUnityBanner(message: string, type: string): void {
  unityWarning.textContent = message
  unityWarning.hidden = false
  unityWarning.classList.toggle('error', type === 'error')
  if (type !== 'error') window.setTimeout(() => { unityWarning.hidden = true }, 5000)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) throw new Error(`요소를 찾을 수 없습니다: ${selector}`)
  return element
}

updateAlbedoView()
updateGeneratedTextureViews()
void loadUnity()
