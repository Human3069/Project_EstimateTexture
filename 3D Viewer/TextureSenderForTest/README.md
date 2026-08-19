# Unity WebGL Texture Sender

컴퓨터에서 선택한 Albedo Map, Height Map, Normal Map의 Blob URL을 만든 후
Unity WebGL의 `CubeHandler.ReceiveTexture(string)`에 전달하는 테스트 도구입니다.
Base64 문자열 복사를 피하여 WebGL 메모리 사용량을 줄입니다.

이미지를 선택하면 해당 TextureType이 즉시 Unity에 적용됩니다. 이미지를 제거하면
같은 TextureType과 `url: null`이 즉시 전달됩니다. Unity가 아직 로딩 중이면
변경사항을 보관했다가 연결 완료 후 자동으로 적용합니다.

## 전송 데이터 형식

WebGL의 `SendMessage`는 함수 인자를 하나만 전달할 수 있으므로 이미지 URL과
텍스처 종류를 JSON 문자열 하나로 묶습니다.

```json
{
  "url": "blob:http://localhost:5173/...",
  "textureType": 0
}
```

`textureType` 값은 양쪽에서 동일해야 합니다.

```text
0 = AlbedoMap
1 = HeightMap
2 = NormalMap
```

Unity 측 WebGL 진입점은 다음 형태로 구현합니다.

```csharp
[System.Serializable]
private class TextureMessage
{
    public string url;
    public TextureType textureType;
}

public void ReceiveTexture(string json)
{
    TextureMessage message =
        JsonUtility.FromJson<TextureMessage>(json);

    StartCoroutine(LoadTexture(message.textureType, message.url));
}

private IEnumerator LoadTexture(TextureType textureType, string url)
{
    // UnityWebRequestTexture로 Blob URL을 비동기 로드
}
```

`ReceiveTexture(string url, TextureType textureType)`처럼 인자를 두 개 받는 함수는
JavaScript의 `unityInstance.SendMessage()`에서 직접 호출할 수 없습니다.

## Unity 설정

1. Scene에 이름이 정확히 `CubeHandler`인 GameObject를 만듭니다.
2. 해당 컴포넌트에 `public void ReceiveTexture(string json)`을 구현합니다.
3. TypeScript와 Unity의 `TextureType` 숫자 값을 동일하게 유지합니다.

## Unity 인스턴스 연결

이 프로젝트는 `../Builds`의 Unity WebGL 빌드를 `public/unity`로 복사한 뒤,
Unity 로더와 캔버스를 프런트엔드 안에서 직접 실행합니다. 로딩이 끝난 인스턴스는
자동으로 등록되므로 별도의 Unity HTML 템플릿 수정은 필요하지 않습니다.

```javascript
createUnityInstance(canvas, config, onProgress).then((unityInstance) => {
  window.registerUnityInstance(unityInstance);
});
```

이미 Unity 템플릿이 `window.unityInstance`에 인스턴스를 저장한다면 별도 등록은
필요하지 않습니다.

## 실행

```powershell
npm install
npm run dev
```

실행 후 `http://localhost:5173`에서 프런트엔드와 3D Viewer를 함께 확인합니다.

Unity를 새로 빌드한 경우 다음 명령으로 빌드 파일만 다시 복사할 수 있습니다.

```powershell
npm run sync-unity
```

`npm run build`는 Unity 빌드를 자동으로 다시 복사하고 배포용 `dist` 폴더를
생성합니다. `.br` 파일에 필요한 Brotli 응답 헤더는 Vite 개발/미리보기 서버에서
자동으로 설정됩니다.

## 프런트엔드 단독 테스트

개발 서버에서 아래 주소를 열면 실제 Unity 대신 모의 수신기가 연결됩니다.

```text
http://localhost:5173/?mockUnity=1
```

이 기능은 Vite 개발 모드에서만 동작하며 배포 빌드에서는 활성화되지 않습니다.
