import { useRef, useState } from "react";

const LANG_MAP: Record<string, string> = {
  en: "en-US",
  fr: "fr-FR",
  ar: "ar-SA",
  ja: "ja-JP",
  zh: "zh-CN",
  ru: "ru-RU",
};

export function useSpeechRecognition(lang: string) {
  const recRef = useRef<any>(null);
  const [isRecording, setIsRecording] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  function start(onFinal: (text: string) => void) {
    if (!supported) return;
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    recRef.current = rec;
    rec.lang = LANG_MAP[lang] ?? "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    let final = "";

    rec.onstart  = () => setIsRecording(true);
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + " ";
      }
    };
    rec.onend    = () => {
      setIsRecording(false);
      const trimmed = final.trim();
      if (trimmed) onFinal(trimmed);
    };
    rec.onerror  = () => setIsRecording(false);

    rec.start();
  }

  function stop() { recRef.current?.stop(); }

  return { isRecording, supported, start, stop };
}
