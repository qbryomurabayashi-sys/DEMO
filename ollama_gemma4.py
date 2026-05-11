import urllib.request
import json
import sys

# ==============================================================================
# ローカルOllama連携用スクリプト (Gemma 4 E4B / E2B)
# ==============================================================================
# アプリケーションの外部から、同じプロンプトを使用してローカルのOllamaを
# 操作するためのサンプル実装です。
# ==============================================================================

# OllamaのAPIエンドポイント (ローカル)
OLLAMA_URL = "http://localhost:11434/api/generate"

def run_ollama_gemma4(prompt_text: str, model_type: str = "e4b"):
    """
    ローカルのOllama APIを叩いて推論を行う
    """
    # E4BとE2Bのモデル名（ローカルのOllamaに登録されている名前に合わせる必要があります）
    model_name = "gemma4:e4b" if model_type == "e4b" else "gemma4:e2b"
    
    print(f"[{model_name}] を使用してOllamaにリクエストを送信中...\n")
    
    payload = {
        "model": model_name,
        "prompt": prompt_text,
        "stream": True
    }
    
    req = urllib.request.Request(OLLAMA_URL, data=json.dumps(payload).encode('utf-8'))
    req.add_header('Content-Type', 'application/json')
    
    try:
        with urllib.request.urlopen(req) as response:
            for line in response:
                if line:
                    data = json.loads(line)
                    if "response" in data:
                        print(data["response"], end="", flush=True)
                    if data.get("done"):
                        print("\n\n--- 処理完了 ---")
                        break
    except urllib.error.URLError as e:
        print(f"接続エラー: Ollamaが起動していないか、アドレスが間違っています。\n詳細: {e}")
        print("ヒント: 'ollama serve' が実行されているか確認してください。")
        sys.exit(1)
    except Exception as e:
        print(f"エラーが発生しました: {e}")
        sys.exit(1)

if __name__ == "__main__":
    print("=== Ollama Gemma 4 (E4B / E2B) ローカル実行ツール ===")
    print("Ollamaに登録された gemma4:e4b または gemma4:e2b モデルを使用します。\n")
    
    print("1. Gemma 4 E4B (高精度)")
    print("2. Gemma 4 E2B (高速・軽量)")
    choice = input("使用するモデルを選択してください (1/2): ")
    
    selected_model_type = "e2b" if choice == "2" else "e4b"
    
    print("\n推論用テキスト（議事録やプロンプト）を入力してください。")
    print("終了するには空行（Enterのみ）を入力してください:")
    
    user_lines = []
    while True:
        line = input()
        if not line:
            break
        user_lines.append(line)
        
    text_input = "\n".join(user_lines)
    
    if not text_input.strip():
        print("\n[テストデータを使用します]")
        text_input = "以下の議事録から、重要な決定事項と、次のアクションを箇条書きで抽出して。\n[00:00:10] A: 次のアップデートについて話し合いましょう。\n[00:00:20] A: 来週までに私が新しいUI案を作成します。\n[00:00:25] B: わかりました。バックエンドのAPI修正を進めます。"
        
    print("\n----------------------------------------")
    run_ollama_gemma4(text_input, model_type=selected_model_type)
