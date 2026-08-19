// http://localhost:5173/?mockUnity=1
// http://localhost:5173/

import './style.css'

enum TextureType {
  AlbedoMap = 0,
  HeightMap = 1,
  NormalMap = 2,
}

interface UnityInstance {
  SendMessage(
    gameObjectName: string,
    methodName: string,
    parameter?: string | number,
  ): void
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

interface TextureSlot {
  type: TextureType
  label: string
  description: string
  file: File | null
  objectUrl: string | null
  hasPendingChange: boolean
}

interface TextureMessage {
  url: string | null
  textureType: TextureType
}

declare global {
  interface Window {
    unityInstance?: UnityInstance
    registerUnityInstance: (instance: UnityInstance) => void
    createUnityInstance?: (
      canvas: HTMLCanvasElement,
      config: UnityConfig,
      onProgress: (progress: number) => void,
    ) => Promise<UnityInstance>
  }
}

const TARGET_GAME_OBJECT = 'CubeHandler'
const TARGET_METHOD = 'ReceiveTexture'
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_TEXTURE_DIMENSION = 4096
const UNITY_ROOT = '/unity'
const IS_MOCK_UNITY =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('mockUnity') === '1'

const textureSlots: TextureSlot[] = [
  createTextureSlot(
    TextureType.AlbedoMap,
    'Albedo Map',
    '모델의 기본 색상 텍스처',
  ),
  createTextureSlot(
    TextureType.HeightMap,
    'Height Map',
    '표면 높이 정보를 담은 텍스처',
  ),
  createTextureSlot(
    TextureType.NormalMap,
    'Normal Map',
    '표면 방향 정보를 담은 텍스처',
  ),
]

let registeredUnityInstance: UnityInstance | null = null

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="sender">
    <header class="sender-header">
      <div>
        <h1>Unity WebGL Texture Sender</h1>
        <p class="description">세 가지 텍스처를 선택하고 Unity WebGL로 전송합니다.</p>
      </div>
      <div class="connection-state">
        <span class="connection-dot" aria-hidden="true"></span>
        <span id="unity-state">연결 대기 중</span>
      </div>
    </header>

    <section class="viewer-panel" aria-labelledby="viewer-title">
      <div class="viewer-heading">
        <div>
          <h2 id="viewer-title">3D Viewer</h2>
          <p>빌드된 Unity WebGL 콘텐츠</p>
        </div>
        <button id="fullscreen-button" class="secondary-button" type="button" disabled>
          전체화면
        </button>
      </div>

      <div class="viewer-stage">
        <canvas id="unity-canvas" width="960" height="600" tabindex="-1"></canvas>
        <div id="unity-loading" class="unity-loading">
          <strong id="unity-loading-text">Unity WebGL 준비 중...</strong>
          <progress id="unity-progress" max="1" value="0"></progress>
        </div>
        <div id="unity-warning" class="unity-warning" hidden></div>
      </div>
    </section>

    <section class="texture-grid" aria-label="텍스처 선택">
      ${textureSlots.map(createTextureSlotHtml).join('')}
    </section>

  </main>
`

const unityState = requiredElement<HTMLElement>('#unity-state')
const connectionState = requiredElement<HTMLElement>('.connection-state')
const unityCanvas = requiredElement<HTMLCanvasElement>('#unity-canvas')
const unityLoading = requiredElement<HTMLElement>('#unity-loading')
const unityLoadingText = requiredElement<HTMLElement>('#unity-loading-text')
const unityProgress = requiredElement<HTMLProgressElement>('#unity-progress')
const unityWarning = requiredElement<HTMLElement>('#unity-warning')
const fullscreenButton = requiredElement<HTMLButtonElement>('#fullscreen-button')

for (const slot of textureSlots) {
  const input = getSlotElement<HTMLInputElement>(slot.type, 'input')
  const removeButton = getSlotElement<HTMLButtonElement>(slot.type, 'remove')

  input.addEventListener('change', () => {
    void handleTextureChange(slot, input)
  })

  removeButton.addEventListener('click', () => {
    removeTexture(slot)
  })
}

window.registerUnityInstance = (instance: UnityInstance): void => {
  registeredUnityInstance = instance
  window.unityInstance = instance
  fullscreenButton.disabled = false
  updateConnectionState()
  void sendPendingTextures()
}

fullscreenButton.addEventListener('click', (): void => {
  getUnityInstance()?.SetFullscreen(1)
})

unityCanvas.addEventListener('pointerdown', (): void => {
  unityCanvas.focus()
})

async function sendTexture(slot: TextureSlot): Promise<void> {
  const unityInstance = getUnityInstance()

  if (unityInstance === null) {
    slot.hasPendingChange = true
    return
  }

  try {
    const message: TextureMessage = {
      url: slot.objectUrl,
      textureType: slot.type,
    }

    unityInstance.SendMessage(
      TARGET_GAME_OBJECT,
      TARGET_METHOD,
      JSON.stringify(message),
    )

    slot.hasPendingChange = false
  } catch (error) {
    console.error(`${slot.label} 적용에 실패했습니다.`, error)
    slot.hasPendingChange = true
  }
}

async function sendPendingTextures(): Promise<void> {
  for (const slot of textureSlots.filter((item) => item.hasPendingChange)) {
    await sendTexture(slot)
    await waitForNextFrame()
  }
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

async function handleTextureChange(
  slot: TextureSlot,
  input: HTMLInputElement,
): Promise<void> {
  const file = input.files?.[0]

  if (file === undefined) {
    clearSlot(slot)
    return
  }

  if (!file.type.startsWith('image/')) {
    clearSlot(slot)
    console.warn(`${slot.label}: 이미지 파일만 선택할 수 있습니다.`)
    return
  }

  if (file.size > MAX_FILE_SIZE) {
    clearSlot(slot)
    console.warn(`${slot.label}: 10MB 이하의 이미지를 선택해 주세요.`)
    return
  }

  try {
    await validateImageDimensions(file)

    slot.file = file
    revokeObjectUrl(slot)
    slot.objectUrl = URL.createObjectURL(file)
    slot.hasPendingChange = true
    updateSlotView(slot)
    await sendTexture(slot)
  } catch (error) {
    console.error(`${slot.label}을 읽지 못했습니다.`, error)
    clearSlot(slot)
  }
}

async function validateImageDimensions(file: File): Promise<void> {
  const bitmap = await createImageBitmap(file)

  try {
    if (
      bitmap.width > MAX_TEXTURE_DIMENSION ||
      bitmap.height > MAX_TEXTURE_DIMENSION
    ) {
      throw new Error(
        `이미지 해상도는 ${MAX_TEXTURE_DIMENSION}x${MAX_TEXTURE_DIMENSION} 이하여야 합니다.`,
      )
    }
  } finally {
    bitmap.close()
  }
}

function createTextureSlot(
  type: TextureType,
  label: string,
  description: string,
): TextureSlot {
  return {
    type,
    label,
    description,
    file: null,
    objectUrl: null,
    hasPendingChange: false,
  }
}

function createTextureSlotHtml(slot: TextureSlot): string {
  const typeName = TextureType[slot.type]

  return `
    <article class="texture-card" data-texture-type="${slot.type}">
      <div class="texture-card-heading">
        <div>
          <h2>${slot.label}</h2>
          <p>${slot.description}</p>
        </div>
        <span class="texture-status">미선택</span>
      </div>

      <div class="preview-box">
        <img data-role="preview" alt="${slot.label} 미리보기" hidden />
        <span data-role="empty-preview">이미지가 없습니다.</span>
      </div>

      <div class="texture-actions">
        <label class="file-picker" for="input-${typeName}">이미지 선택</label>
        <button
          class="remove-texture-button"
          data-role="remove"
          type="button"
          disabled
        >이미지 제거</button>
      </div>
      <input
        id="input-${typeName}"
        data-role="input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
      />

      <dl class="file-info">
        <div><dt>파일</dt><dd data-role="file-name">-</dd></div>
        <div><dt>크기</dt><dd data-role="file-size">-</dd></div>
      </dl>
    </article>
  `
}

function updateSlotView(slot: TextureSlot): void {
  const preview = getSlotElement<HTMLImageElement>(slot.type, 'preview')
  const emptyPreview = getSlotElement<HTMLElement>(slot.type, 'empty-preview')
  const fileName = getSlotElement<HTMLElement>(slot.type, 'file-name')
  const fileSize = getSlotElement<HTMLElement>(slot.type, 'file-size')
  const textureStatus = getSlotStatus(slot.type)
  const removeButton = getSlotElement<HTMLButtonElement>(slot.type, 'remove')

  preview.src = slot.objectUrl ?? ''
  preview.hidden = slot.objectUrl === null
  emptyPreview.hidden = slot.objectUrl !== null
  fileName.textContent = slot.file?.name ?? '-'
  fileSize.textContent = slot.file === null ? '-' : formatBytes(slot.file.size)
  textureStatus.textContent = slot.file === null ? '미선택' : '준비됨'
  textureStatus.classList.toggle('ready', slot.file !== null)
  removeButton.disabled = slot.file === null
}

function clearSlot(
  slot: TextureSlot,
  hasPendingChange = false,
): void {
  const input = getSlotElement<HTMLInputElement>(slot.type, 'input')

  revokeObjectUrl(slot)
  slot.file = null
  slot.objectUrl = null
  slot.hasPendingChange = hasPendingChange
  input.value = ''
  updateSlotView(slot)
}

function revokeObjectUrl(slot: TextureSlot): void {
  if (slot.objectUrl === null) {
    return
  }

  URL.revokeObjectURL(slot.objectUrl)
  slot.objectUrl = null
}

function removeTexture(slot: TextureSlot): void {
  clearSlot(slot, true)
  void sendTexture(slot)
}

function getSlotElement<T extends Element>(
  textureType: TextureType,
  role: string,
): T {
  const card = getTextureCard(textureType)
  return requiredElementFrom<T>(card, `[data-role="${role}"]`)
}

function getSlotStatus(textureType: TextureType): HTMLElement {
  return requiredElementFrom<HTMLElement>(
    getTextureCard(textureType),
    '.texture-status',
  )
}

function getTextureCard(textureType: TextureType): HTMLElement {
  return requiredElement<HTMLElement>(
    `[data-texture-type="${textureType}"]`,
  )
}

function getUnityInstance(): UnityInstance | null {
  return registeredUnityInstance ?? window.unityInstance ?? null
}

async function loadUnity(): Promise<void> {
  try {
    const manifest = await loadUnityBuildManifest()
    const buildRoot = `${UNITY_ROOT}/Build`

    await loadScript(`${buildRoot}/${manifest.loader}`)

    if (window.createUnityInstance === undefined) {
      throw new Error('Unity 로더에서 createUnityInstance를 찾지 못했습니다.')
    }

    const config: UnityConfig = {
      arguments: [],
      dataUrl: `${buildRoot}/${manifest.data}`,
      frameworkUrl: `${buildRoot}/${manifest.framework}`,
      codeUrl: `${buildRoot}/${manifest.code}`,
      streamingAssetsUrl: `${UNITY_ROOT}/StreamingAssets`,
      companyName: 'DefaultCompany',
      productName: 'EstimateTexture_3DViewer',
      productVersion: '0.1.0',
      showBanner: showUnityBanner,
    }

    const instance = await window.createUnityInstance(
      unityCanvas,
      config,
      (progress) => {
        unityProgress.value = progress
        unityLoadingText.textContent =
          `Unity WebGL 로딩 중... ${Math.round(progress * 100)}%`
      },
    )

    unityLoading.hidden = true
    window.registerUnityInstance(instance)
  } catch (error) {
    console.error(error)
    unityLoadingText.textContent = 'Unity WebGL을 불러오지 못했습니다.'
    showUnityBanner(
      error instanceof Error ? error.message : String(error),
      'error',
    )
  }
}

async function loadUnityBuildManifest(): Promise<UnityBuildManifest> {
  const response = await fetch(`${UNITY_ROOT}/build-manifest.json`, {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(
      `Unity 빌드 정보 로드 실패: ${response.status} ${response.statusText}`,
    )
  }

  return response.json() as Promise<UnityBuildManifest>
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

  if (type !== 'error') {
    window.setTimeout(() => {
      unityWarning.hidden = true
    }, 5000)
  }
}

function updateConnectionState(): void {
  const connected = getUnityInstance() !== null

  unityState.textContent = connected ? '연결됨' : '연결 대기 중'
  connectionState.classList.toggle('connected', connected)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)

  if (element === null) {
    throw new Error(`요소를 찾을 수 없습니다: ${selector}`)
  }

  return element
}

function requiredElementFrom<T extends Element>(
  parent: Element,
  selector: string,
): T {
  const element = parent.querySelector<T>(selector)

  if (element === null) {
    throw new Error(`요소를 찾을 수 없습니다: ${selector}`)
  }

  return element
}

if (IS_MOCK_UNITY) {
  unityLoading.hidden = true
  unityCanvas.classList.add('mock-canvas')

  window.registerUnityInstance({
    SendMessage(gameObjectName, methodName, parameter): void {
      const history = JSON.parse(
        document.documentElement.dataset.unityMessageHistory ?? '[]',
      ) as unknown[]

      history.push({ gameObjectName, methodName, parameter })

      document.documentElement.dataset.unityMessageHistory =
        JSON.stringify(history)
    },
    SetFullscreen(): void {},
  })
} else {
  void loadUnity()
}

updateConnectionState()
