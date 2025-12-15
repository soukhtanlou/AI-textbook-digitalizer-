
import JSZip from 'jszip';
import { CourseData } from "../types";
import { decodeBase64 } from "../utils/audioUtils";

// Helper to get raw bytes from Data URL
function dataURItoBlob(dataURI: string): Blob {
    // Split metadata from data
    const parts = dataURI.split(',');
    const byteString = atob(parts[1]);
    const mimeString = parts[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
}

export const exportToZip = async (course: CourseData) => {
  const zip = new JSZip();
  const assets = zip.folder("assets");
  
  if (!assets) throw new Error("Could not create assets folder");

  // Iterate over pages and add files to the ZIP
  const exportPages = await Promise.all(course.pages.map(async (p) => {
    const pagePrefix = `p${p.pageNumber}`;
    
    // 1. Main Image (Stored as Base64 in state)
    // We convert it to binary for ZIP
    // Fix: cast to any to avoid TS strict error regarding SharedArrayBuffer vs ArrayBuffer
    const imgBlob = new Blob([decodeBase64(p.imageBase64) as any], { type: 'image/jpeg' });
    assets.file(`${pagePrefix}_main.jpg`, imgBlob);

    // 2. Teacher Audio
    let teacherAudioPath = null;
    if (p.includeTeacherAudio && p.teacherAudioBlob) {
        assets.file(`${pagePrefix}_teacher.wav`, p.teacherAudioBlob);
        teacherAudioPath = `assets/${pagePrefix}_teacher.wav`;
    }

    // 3. Storyboard Image (Data URI from Gemini)
    let storyboardPath = null;
    if (p.includeStoryboard && p.storyboardImage) {
        const sbBlob = dataURItoBlob(p.storyboardImage);
        assets.file(`${pagePrefix}_storyboard.png`, sbBlob);
        storyboardPath = `assets/${pagePrefix}_storyboard.png`;
    }

    // 4. Video (Veo)
    let videoPath = null;
    if (p.includeVideo && p.videoBlob) {
        assets.file(`${pagePrefix}_video.mp4`, p.videoBlob);
        videoPath = `assets/${pagePrefix}_video.mp4`;
    }

    // 5. Dialogue Audio
    let dialogueAudioPath = null;
    if (p.includeDialogueAudio && p.dialogueAudioBlob) {
        assets.file(`${pagePrefix}_dialogue.wav`, p.dialogueAudioBlob);
        dialogueAudioPath = `assets/${pagePrefix}_dialogue.wav`;
    }

    // Return the data structure that the HTML player will use
    return {
        pageNumber: p.pageNumber,
        // extractedText & imageDescription removed from export data to save space and ensure privacy
        
        imagePath: `assets/${pagePrefix}_main.jpg`,
        teacherAudioPath,
        storyboardPath,
        videoPath,
        dialogueAudioPath
    };
  }));

  const exportData = {
      title: course.title,
      pages: exportPages
  };

  // Generate the Index HTML
  const htmlContent = `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${course.title}</title>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet" type="text/css" />
    <style>
        :root {
            --bg-color: #f0f2f5;
            --text-color: #333;
            --card-bg: #fff;
            --header-bg: #0e7490;
            --header-text: #fff;
            --btn-bg: rgba(255,255,255,0.2);
            --btn-text: white;
            --section-border: #f1f5f9;
        }

        body.high-contrast {
            --bg-color: #000;
            --text-color: #ffd700;
            --card-bg: #111;
            --header-bg: #333;
            --header-text: #ffd700;
            --btn-bg: #444;
            --btn-text: #ffd700;
            --section-border: #444;
        }

        body { margin: 0; font-family: 'Vazirmatn', sans-serif; background: var(--bg-color); color: var(--text-color); height: 100vh; display: flex; flex-direction: column; overflow: hidden; transition: all 0.3s; }
        
        .header { background: var(--header-bg); color: var(--header-text); padding: 0.5rem 1rem; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.2); z-index: 10; flex-shrink: 0; display: flex; flex-direction: column; gap: 0.5rem; }
        .header-top { display: flex; justify-content: space-between; align-items: center; width: 100%; }
        .toolbar { display: flex; gap: 0.5rem; justify-content: center; padding-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.1); }
        
        .content-area { flex: 1; overflow-y: auto; padding: 1rem; max-width: 800px; margin: 0 auto; width: 100%; box-sizing: border-box; }
        .card { background: var(--card-bg); border-radius: 1rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden; margin-bottom: 2rem; border: 1px solid var(--section-border); }
        
        .image-container { overflow: hidden; position: relative; width: 100%; background: #000; cursor: grab; }
        .image-container:active { cursor: grabbing; }
        .page-image { width: 100%; display: block; transition: transform 0.2s ease-out; transform-origin: center center; pointer-events: none; }
        
        .section { padding: 1rem; border-bottom: 1px solid var(--section-border); }
        .section:last-child { border-bottom: none; }
        .section-title { font-size: 1rem; font-weight: bold; opacity: 0.8; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
        
        .audio-player { width: 100%; margin-top: 0.5rem; }
        .storyboard-img { width: 100%; border-radius: 0.5rem; border: 2px solid #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .video-player { width: 100%; border-radius: 0.5rem; background: #000; }
        
        .btn { background: var(--btn-bg); border: 1px solid var(--btn-bg); color: var(--btn-text); padding: 0.5rem 1rem; border-radius: 0.5rem; cursor: pointer; font-family: inherit; font-size: 1rem; transition: 0.2s; }
        .btn:hover { opacity: 0.8; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .tool-btn { font-size: 0.8rem; padding: 0.3rem 0.6rem; }

        .speed-controls { display: flex; gap: 5px; margin-top: 5px; }
        .speed-btn { background: #e2e8f0; border: none; border-radius: 4px; padding: 2px 8px; font-size: 0.8rem; cursor: pointer; color: #333; }
        .speed-btn.active { background: #0e7490; color: white; }
        body.high-contrast .speed-btn { background: #333; color: #ffd700; border: 1px solid #ffd700; }
        body.high-contrast .speed-btn.active { background: #ffd700; color: #000; }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-top">
            <button id="prevBtn" class="btn">قبلی</button>
            <span id="pageTitle" style="font-weight: bold; font-size: 1.2rem;"></span>
            <button id="nextBtn" class="btn">بعدی</button>
        </div>
        <div class="toolbar">
            <button id="contrastBtn" class="btn tool-btn">👁️ کنتراست</button>
            <button id="zoomInBtn" class="btn tool-btn">🔍 +</button>
            <button id="zoomOutBtn" class="btn tool-btn">🔍 -</button>
            <button id="resetZoomBtn" class="btn tool-btn">بازنشانی</button>
        </div>
    </div>

    <div id="app" class="content-area"></div>

    <script>
        const DATA = ${JSON.stringify(exportData)};
        let currentPageIndex = 0;
        let currentZoom = 1;
        let panX = 0;
        let panY = 0;

        const appEl = document.getElementById('app');
        const titleEl = document.getElementById('pageTitle');
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        const contrastBtn = document.getElementById('contrastBtn');
        
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const resetZoomBtn = document.getElementById('resetZoomBtn');

        function updateZoom() {
            const img = document.querySelector('.page-image');
            if(img) {
                img.style.transform = \`scale(\${currentZoom}) translate(\${panX}px, \${panY}px)\`;
            }
        }

        zoomInBtn.onclick = () => { currentZoom += 0.2; updateZoom(); };
        zoomOutBtn.onclick = () => { currentZoom = Math.max(1, currentZoom - 0.2); updateZoom(); };
        resetZoomBtn.onclick = () => { currentZoom = 1; panX = 0; panY = 0; updateZoom(); };
        contrastBtn.onclick = () => { document.body.classList.toggle('high-contrast'); };

        function renderPage(index) {
            currentZoom = 1; panX = 0; panY = 0;
            const page = DATA.pages[index];
            if (!page) return;

            titleEl.textContent = \`\${DATA.title} - صفحه \${page.pageNumber}\`;
            
            let html = \`
                <div class="card">
                    <div class="image-container" id="imgContainer">
                        <img src="\${page.imagePath}" class="page-image" />
                    </div>
                    
                    \${page.teacherAudioPath ? \`
                    <div class="section" style="background: rgba(224, 231, 255, 0.3);">
                        <div class="section-title">🔊 توضیحات معلم</div>
                        <audio id="audio-teacher" controls class="audio-player" src="\${page.teacherAudioPath}"></audio>
                        <div class="speed-controls">
                             <button class="speed-btn" onclick="setSpeed('audio-teacher', 0.75, this)">کند</button>
                             <button class="speed-btn active" onclick="setSpeed('audio-teacher', 1.0, this)">عادی</button>
                             <button class="speed-btn" onclick="setSpeed('audio-teacher', 1.25, this)">تند</button>
                        </div>
                    </div>
                    \` : ''}

                    \${page.storyboardPath ? \`
                    <div class="section">
                        <div class="section-title">🎨 تصویرسازی آموزشی</div>
                        <img src="\${page.storyboardPath}" class="storyboard-img" />
                    </div>
                    \` : ''}

                    \${page.videoPath ? \`
                    <div class="section">
                        <div class="section-title">🎬 ویدیوی آموزشی</div>
                        <video controls class="video-player" src="\${page.videoPath}"></video>
                    </div>
                    \` : ''}

                    \${page.dialogueAudioPath ? \`
                    <div class="section" style="background: rgba(204, 251, 241, 0.3);">
                        <div class="section-title">🗣️ گفتگوی کلاسی</div>
                        <audio id="audio-dialogue" controls class="audio-player" src="\${page.dialogueAudioPath}"></audio>
                        <div class="speed-controls">
                             <button class="speed-btn" onclick="setSpeed('audio-dialogue', 0.75, this)">کند</button>
                             <button class="speed-btn active" onclick="setSpeed('audio-dialogue', 1.0, this)">عادی</button>
                             <button class="speed-btn" onclick="setSpeed('audio-dialogue', 1.25, this)">تند</button>
                        </div>
                    </div>
                    \` : ''}
                </div>
            \`;

            appEl.innerHTML = html;
            
            const container = document.getElementById('imgContainer');
            let isDragging = false;
            let startX, startY;

            container.addEventListener('mousedown', (e) => {
                if(currentZoom > 1) {
                    isDragging = true;
                    startX = e.clientX - panX;
                    startY = e.clientY - panY;
                }
            });

            window.addEventListener('mouseup', () => isDragging = false);
            
            container.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                e.preventDefault();
                panX = e.clientX - startX;
                panY = e.clientY - startY;
                updateZoom();
            });
            
            prevBtn.disabled = index === 0;
            nextBtn.disabled = index === DATA.pages.length - 1;
        }

        window.setSpeed = function(audioId, rate, btn) {
            const audio = document.getElementById(audioId);
            if(audio) {
                audio.playbackRate = rate;
                const parent = btn.parentElement;
                Array.from(parent.children).forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
            }
        };

        prevBtn.addEventListener('click', () => {
            if (currentPageIndex > 0) {
                currentPageIndex--;
                renderPage(currentPageIndex);
            }
        });

        nextBtn.addEventListener('click', () => {
            if (currentPageIndex < DATA.pages.length - 1) {
                currentPageIndex++;
                renderPage(currentPageIndex);
            }
        });

        renderPage(0);
    </script>
</body>
</html>
  `;

  zip.file("index.html", htmlContent);

  // Generate the ZIP file asynchronously
  const content = await zip.generateAsync({type: "blob"});
  
  // Trigger Download
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${course.title.replace(/\s+/g, '_')}_Package.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
