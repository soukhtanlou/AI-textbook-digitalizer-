
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { decodeBase64, pcmToWav } from "../utils/audioUtils";

// Internal variable to store the key at runtime
let runtimeApiKey = '';

export const setApiKey = (key: string) => {
  // Sanitize key: remove non-printable characters and whitespace
  runtimeApiKey = key.replace(/[^\x20-\x7E]/g, '').trim();
};

const getAiClient = () => {
  if (!runtimeApiKey) throw new Error("API Key وارد نشده است. لطفا وارد شوید.");
  // Ensure key is clean before use
  const cleanKey = runtimeApiKey.replace(/[^\x20-\x7E]/g, '').trim();
  return new GoogleGenAI({ apiKey: cleanKey });
};

// Helper: Execute with Retry for Rate Limits (429)
const executeWithRetry = async <T>(fn: () => Promise<T>, retries = 3, baseDelay = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const msg = error.message || '';
    const isQuotaError = msg.includes('429') || 
                         msg.includes('RESOURCE_EXHAUSTED') || 
                         msg.includes('Quota exceeded') ||
                         error.status === 429;
    
    if (retries > 0 && isQuotaError) {
      console.warn(`Quota limit hit. Retrying in ${baseDelay}ms... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, baseDelay));
      return executeWithRetry(fn, retries - 1, baseDelay * 2); // Exponential backoff
    }
    throw error;
  }
};

// Helper to translate text to English (internal use)
const translateToEnglish = async (text: string): Promise<string> => {
    const ai = getAiClient();
    return executeWithRetry(async () => {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ text: `Translate the following text to English for a video/image generation prompt. Keep it concise, visual, and descriptive.\n\nText: ${text}` }] }
        });
        return response.text || text;
    });
};

// --- 0. SINGLE PAGE ANALYSIS ---

export const analyzeSinglePage = async (imageBase64: string): Promise<{analysis: string, text: string, description: string}> => {
  const ai = getAiClient();
  const prompt = `
    تصویر این صفحه کتاب درسی را تحلیل کن.
    سه خروجی مجزا نیاز دارم (همه باید کاملاً به زبان **فارسی** باشند):
    
    1. **تحلیل:** هدف آموزشی این صفحه چیست؟ چه نکاتی مهم است؟ (کوتاه و مفید به فارسی)
    2. **متن:** تمام متن‌های قابل خواندن در صفحه را استخراج کن. (به همان زبان تصویر که معمولا فارسی است)
    3. **شرح تصویر:** تصاویر موجود در صفحه را با جزئیات توصیف کن (بدون متن). (توصیف به زبان فارسی)
    
    خروجی را حتما به فرمت JSON برگردان:
    {
      "analysis": "...",
      "text": "...",
      "description": "..."
    }
  `;

  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
             analysis: { type: Type.STRING },
             text: { type: Type.STRING },
             description: { type: Type.STRING }
          }
        }
      }
    });

    try {
        const json = JSON.parse(response.text || "{}");
        return {
            analysis: json.analysis || "",
            text: json.text || "",
            description: json.description || ""
        };
    } catch (e) {
        return { analysis: "خطا در پردازش", text: "", description: "" };
    }
  });
};


// --- 1. GLOBAL ANALYSIS (THE BRAIN) ---

export const analyzeCourseMap = async (context: string, pages: {pageNumber: number, imageBase64: string}[]): Promise<string> => {
  const ai = getAiClient();
  
  const contentParts: any[] = [];
  contentParts.push({ 
    text: `
    نقش: شما یک برنامه‌ریز آموزشی ارشد هستید.
    وظیفه: تحلیل تصاویر یک فصل از کتاب درسی و ارائه "نقشه راه تدریس".
    
    زمینه معلم: "${context}"
    تعداد صفحات: ${pages.length}
    
    دستورالعمل:
    1. تمام تصاویر زیر را به ترتیب بررسی کنید.
    2. ارتباط معنایی بین صفحات را پیدا کنید.
    3. برای **هر صفحه** یک استراتژی مشخص کنید.
    
    خروجی باید دقیقاً به زبان **فارسی** و با فرمت زیر باشد:
    
    --- استراتژی فصل ---
    (یک پاراگراف توضیح کلی)
    
    --- تحلیل صفحه به صفحه ---
    صفحه 1: [عنوان] - [نقش صفحه] - [پیشنهاد رسانه‌ای]
    ...
    ` 
  });

  pages.forEach((page) => {
    contentParts.push({ text: `\n--- تصویر صفحه ${page.pageNumber} ---` });
    contentParts.push({ 
      inlineData: { 
        mimeType: 'image/jpeg', 
        data: page.imageBase64 
      } 
    });
  });

  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: contentParts },
      config: { temperature: 0.2 }
    });
    return response.text || "تحلیل انجام نشد.";
  });
};

// --- 2. TEACHER STUDIO ---

export const generateTeacherScript = async (
    imageBase64: string, 
    globalContext: string, 
    globalStrategy: string,
    localData: { analysis: string, text: string, description: string }
): Promise<string> => {
  const ai = getAiClient();
  const prompt = `
    زمینه کلی درس: ${globalContext}
    نقشه راه و استراتژی فصل: ${globalStrategy}
    
    اطلاعات اختصاصی زیر توسط کاربر ویرایش و تایید شده است (Ground Truth).
    **اولویت با متن‌های زیر است، حتی اگر با برداشت شما از تصویر متفاوت باشد:**
    
    1. تحلیل آموزشی (تایید شده): ${localData.analysis || '(بدون توضیحات)'}
    2. متن موجود در صفحه (تایید شده): ${localData.text || '(متنی در صفحه نیست)'}
    3. شرح تصاویر (تایید شده): ${localData.description || '(بدون تصویر)'}
    
    شما یک معلم دبستان پرانرژی و مهربان هستید که به زبان فارسی صحبت می‌کنید.
    به تصویر صفحه کتاب نگاه کنید و با توجه به متن و تحلیل بالا تدریس کنید.
    
    وظیفه: نوشتن متن تدریس (که قرار است به صوت تبدیل شود).
    
    قوانین حیاتی:
    1. **تکیه بر محتوا:** حتماً مفاهیم موجود در "متن تایید شده کاربر" را تدریس کنید. اگر شعری در متن آمده بخوانید، اگر سوالی هست بپرسید.
    2. **لحن:** فقط روخوانی نکنید. تدریس کنید! با انرژی و زبان ساده برای بچه ۹ ساله.
    3. **اعراب‌گذاری کامل:** کلمات را برای تلفظ صحیح توسط موتور صوتی، کاملاً اعراب‌گذاری (حرکت‌گذاری) کنید. (مثلاً: کِتابِ عُلوم).
    4. **نشانه‌گذاری:** از ویرگول، نقطه و علامت سوال با دقت زیاد استفاده کنید تا مکث‌ها درست باشد.
    
    خروجی: فقط متن فارسی تدریس.
  `;

  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: prompt }
        ]
      }
    });
    return response.text || "خطا در تولید متن معلم.";
  });
};

export const generateSpeech = async (text: string, voiceName: string, speed: number): Promise<Blob> => {
  const ai = getAiClient();
  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("داده صوتی دریافت نشد");

    const pcmData = decodeBase64(base64Audio);
    return pcmToWav(pcmData, 24000, 1);
  });
};

// --- 3. STORYBOARD STUDIO ---

export const generateStoryboardPrompt = async (imageBase64: string): Promise<string> => {
  const ai = getAiClient();
  const prompt = `
    نقش: کارگردان هنری خلاق.
    وظیفه: نوشتن پرامپت استوری‌بورد برای یک تصویرسازی آموزشی.
    
    قوانین خلاقیت:
    1. **کپی نکنید:** عین صفحه کتاب را توصیف نکنید.
    2. **استعاره بسازید:** یک مثال واقعی در زندگی روزمره پیدا کنید که این درس را توضیح دهد.
       (مثال: اگر درس گردش خون است، سیستم لوله‌کشی شهری را تصور کن. اگر کسر است، پیتزا تقسیم کردن را تصور کن).
    3. تصویر باید جذاب، رنگارنگ و مناسب کودکان باشد.
    
    قوانین فنی:
    1. خروجی دقیقاً به زبان **فارسی** باشد.
    2. تصویر باید **بدون متن** باشد (Text-Free). هیچ حرف یا عددی نباید در تصویر باشد.
    3. سبک: وکتور آرت تمیز، طراحی تخت، با کیفیت بالا.
    
    خروجی: فقط متن توصیف تصویر به فارسی.
  `;

  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: prompt }
        ]
      },
      config: { temperature: 0.7 }
    });
    return response.text || "خطا در تولید پرامپت.";
  });
};

export const generateStoryboardImage = async (promptText: string): Promise<string> => {
  const ai = getAiClient();
  
  // 1. Translate Persian prompt to English for better image generation results
  const englishPrompt = await translateToEnglish(promptText);

  // 2. Construct optimized prompt for the image model
  const finalPrompt = `Create a clean educational vector illustration for the following scene: "${englishPrompt}". 
  Style: Flat design, colorful, suitable for children. 
  IMPORTANT CONSTRAINT: The image must be completely text-free. Do not include any letters, numbers, or words inside the illustration.`;

  return executeWithRetry(async () => {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: { parts: [{ text: finalPrompt }] },
          config: {
              imageConfig: {
                  aspectRatio: "1:1"
              }
          }
        });

        // Robust check for image data in candidates
        let imageUrl = "";
        const candidate = response.candidates?.[0];
        
        if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
                if (part.inlineData && part.inlineData.data) {
                    imageUrl = `data:image/png;base64,${part.inlineData.data}`;
                    break;
                }
            }
        }
        
        if (!imageUrl) {
            // Check for text refusal/explanation from the model
            const textPart = candidate?.content?.parts?.find(p => p.text)?.text;
            
            if (textPart) {
                 console.warn("Model returned text instead of image:", textPart);
                 throw new Error(`مدل تصویر را تولید نکرد. پیام مدل: "${textPart.slice(0, 100)}..." (لطفاً پرامپت را تغییر دهید)`);
            }

            const finishReason = candidate?.finishReason;
            if (finishReason) {
                throw new Error(`تولید تصویر متوقف شد. دلیل: ${finishReason}`);
            }
            throw new Error("تصویر تولید نشد. لطفا پرامپت را تغییر دهید یا دوباره تلاش کنید.");
        }
        return imageUrl;
      } catch (error: any) {
          console.error("Storyboard Error:", error);
          throw new Error(error.message || "خطا در ارتباط با سرویس تصویر");
      }
  });
};

// --- 4. VIDEO STUDIO (VEO) ---

export const generateVideoPrompt = async (
    imageBase64: string, 
    localData: { description: string, text: string }
): Promise<string> => {
  const ai = getAiClient();
  const prompt = `
    نقش: کارگردان انیمیشن خلاق.
    وظیفه: نوشتن پرامپت (توصیف صحنه) برای یک ویدیوی کوتاه آموزشی بر اساس این تصویر.
    
    **توجه مهم:** اطلاعات زیر توسط انسان تایید شده است (Ground Truth). برای ساخت ویدیو، دقیقاً بر اساس "شرح تصویر" و "مفهوم متنی" زیر عمل کنید، حتی اگر تصویر چیز دیگری نشان دهد.
    
    شرح تصویر (تایید شده): ${localData.description}
    مفهوم متنی (تایید شده): ${localData.text}
    
    دستورالعمل:
    1. خروجی باید به زبان **فارسی** باشد.
    2. فقط صفحه را متحرک نکنید. مفهوم را متحرک کنید.
    3. مثال: اگر چرخه آب است، بارش باران و حرکت ابرها را توصیف کنید.
    4. ساده و مختصر باشد.
    
    خروجی: فقط متن توصیف صحنه به فارسی.
  `;

  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: prompt }
        ]
      }
    });
    return response.text || "یک انیمیشن آموزشی جذاب بر اساس این تصویر بساز.";
  });
};

export const generateVideo = async (userPrompt: string, imageBase64: string, resolution: '720p' | '1080p' = '720p'): Promise<Blob> => {
  const ai = getAiClient();
  
  // Translate Persian prompt to English for Veo
  const englishPrompt = await translateToEnglish(userPrompt);
  
  return executeWithRetry(async () => {
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: englishPrompt,
        image: {
          imageBytes: imageBase64,
          mimeType: 'image/jpeg',
        },
        config: {
          numberOfVideos: 1,
          resolution: resolution,
          aspectRatio: '16:9'
        }
      });

      // Polling loop
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.getVideosOperation({operation: operation});
      }

      const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!videoUri) throw new Error("تولید ویدیو ناموفق بود: آدرسی دریافت نشد.");

      const response = await fetch(`${videoUri}&key=${runtimeApiKey}`);
      if (!response.ok) throw new Error("دانلود فایل ویدیو ناموفق بود.");
      
      return await response.blob();
  }, 1);
};


// --- 5. DIALOGUE STUDIO ---

export const generateDialogue = async (
    imageBase64: string, 
    teacherScript: string,
    localData: { text: string, description: string }
): Promise<string> => {
  const ai = getAiClient();
  const prompt = `
    **اولویت منابع:** متن صفحه و شرح تصویر زیر توسط معلم تایید شده‌اند (Ground Truth). اگر با تصویر تناقض دارند، ملاک این متن‌هاست.
    
    منبع 1 (متن صفحه - اولویت بالا): ${localData.text || 'ندارد'}
    منبع 2 (شرح تصویر - اولویت بالا): ${localData.description || 'ندارد'}
    منبع 3: متن معلم (${teacherScript.substring(0, 500)}...)
    
    وظیفه: نوشتن یک سناریوی **گفتگوی خلاقانه** بین دو دانش‌آموز (علی و رضا) به زبان فارسی.
    
    قوانین خلاقیت:
    1. **سوال و جواب خشک نباشد:** ننویسید "علی: این چیست؟ رضا: این ابر است".
    2. **سناریو بسازید:** آن‌ها سعی دارند مشکلی که در درس مطرح شده را حل کنند.
    3. **استفاده از متن:** اگر متن صفحه سوالی پرسیده یا نکته‌ای گفته، در دیالوگ به آن اشاره کنند.
    4. **لحن:** صمیمی، دانش‌آموزی و طبیعی.
    
    فرمت:
    علی: ...
    رضا: ...
  `;
  
  return executeWithRetry(async () => {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }, { text: prompt }] },
        config: { temperature: 0.7 }
      });
      return response.text || "";
  });
};

export const generateMultiSpeakerAudio = async (script: string): Promise<Blob> => {
  const ai = getAiClient();
  // Provide English prompt to TTS model but with Persian content
  const prompt = `TTS the following conversation:\n${script}`;
  
  return executeWithRetry(async () => {
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
            multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
                { speaker: 'علی', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }, 
                { speaker: 'رضا', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
            ]
            }
        }
        }
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("صدا تولید نشد");
    return pcmToWav(decodeBase64(base64Audio!), 24000, 1);
  });
};
