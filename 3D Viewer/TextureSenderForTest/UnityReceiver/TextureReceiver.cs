using System;
using UnityEngine;

public sealed class TextureReceiver : MonoBehaviour
{
    [SerializeField] private Renderer targetRenderer;

    private Texture2D receivedTexture;

    public void ReceiveImageDataUrl(string dataUrl)
    {
        try
        {
            if (targetRenderer == null)
            {
                Debug.LogError("Target Renderer가 연결되지 않았습니다.");
                return;
            }

            if (string.IsNullOrWhiteSpace(dataUrl))
            {
                Debug.LogError("수신한 이미지 데이터가 비어 있습니다.");
                return;
            }

            int commaIndex = dataUrl.IndexOf(',');
            if (commaIndex < 0)
            {
                Debug.LogError("올바른 Data URL이 아닙니다.");
                return;
            }

            byte[] imageBytes = Convert.FromBase64String(
                dataUrl.Substring(commaIndex + 1));

            Texture2D texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!texture.LoadImage(imageBytes, false))
            {
                Destroy(texture);
                Debug.LogError("이미지 데이터를 Texture2D로 변환하지 못했습니다.");
                return;
            }

            if (receivedTexture != null)
                Destroy(receivedTexture);

            receivedTexture = texture;
            targetRenderer.material.mainTexture = receivedTexture;

            Debug.Log($"이미지 수신 완료: {texture.width}x{texture.height}");
        }
        catch (Exception exception)
        {
            Debug.LogError($"이미지 수신 실패: {exception.Message}");
        }
    }

    private void OnDestroy()
    {
        if (receivedTexture != null)
            Destroy(receivedTexture);
    }
}
