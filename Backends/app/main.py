### cd D:\Works\Complex\Project_EstimateTexture\Backends 
### .\.venv\Scripts\Activate.ps1
### python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError


BASE_DIR = Path(__file__).resolve().parent.parent
GENERATED_DIR = BASE_DIR / "storage" / "generated"

MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_IMAGE_WIDTH = 4096
MAX_IMAGE_HEIGHT = 4096

GENERATED_DIR.mkdir(parents=True, exist_ok=True)


app = FastAPI(
    title="Estimate Texture API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/generated",
    StaticFiles(directory=GENERATED_DIR),
    name="generated",
)


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {
        "status": "ok",
    }


@app.post("/api/textures/generate")
async def generate_textures(
    request: Request,
    albedo: UploadFile = File(...),
) -> dict[str, str]:
    if albedo.content_type not in {
        "image/png",
        "image/jpeg",
        "image/webp",
    }:
        raise HTTPException(
            status_code=415,
            detail="PNG, JPEG, WEBP 이미지만 업로드할 수 있습니다.",
        )

    image_bytes = await albedo.read()

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="업로드된 이미지가 비어 있습니다.",
        )

    if len(image_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="이미지 크기는 20MB 이하여야 합니다.",
        )

    try:
        with Image.open(BytesIO(image_bytes)) as source_image:
            source_image.load()

            if (
                source_image.width > MAX_IMAGE_WIDTH
                or source_image.height > MAX_IMAGE_HEIGHT
            ):
                raise HTTPException(
                    status_code=413,
                    detail="이미지 해상도는 4096x4096 이하여야 합니다.",
                )

            output_image = source_image.convert("RGBA")

    except UnidentifiedImageError as error:
        raise HTTPException(
            status_code=400,
            detail="유효한 이미지 파일이 아닙니다.",
        ) from error

    request_id = uuid4().hex
    result_directory = GENERATED_DIR / request_id
    result_directory.mkdir(parents=True, exist_ok=False)

    height_map_path = result_directory / "height.png"
    normal_map_path = result_directory / "normal.png"

    # 현재 임시 구현:
    # Albedo 이미지를 HeightMap과 NormalMap으로 그대로 저장합니다.
    output_image.save(height_map_path, format="PNG")
    output_image.save(normal_map_path, format="PNG")

    base_url = str(request.base_url).rstrip("/")

    return {
        "requestId": request_id,
        "heightMapUrl": (
            f"{base_url}/generated/{request_id}/height.png"
        ),
        "normalMapUrl": (
            f"{base_url}/generated/{request_id}/normal.png"
        ),
    }