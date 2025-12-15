
export enum AppView {
  COURSE_LIST = 'COURSE_LIST', // List of all projects
  DASHBOARD = 'DASHBOARD',     // Specific Course Setup & Analysis
  EDITOR = 'EDITOR',           // Page Editing
  PLAYER = 'PLAYER'            // Final View (Preview mode inside app)
}

export interface PageData {
  id: string;
  pageNumber: number;
  imageBase64: string;
  
  // Base Content & Analysis (New Fields)
  aiAnalysis: string;       // General AI analysis of the page
  extractedText: string;    // Text inside the page
  imageDescription: string; // Description of images
  isContentConfirmed: boolean; // Has the user verified this content?
  
  // Teacher
  teacherScript: string;
  teacherAudioBlob: Blob | null;
  teacherVoice: string;
  teacherAudioSpeed: number; // 0.5 to 2.0
  includeTeacherAudio: boolean;

  // Storyboard
  storyboardPrompt: string;
  storyboardImage: string | null; // Base64 of the generated image
  includeStoryboard: boolean;

  // Video (Veo)
  videoPrompt: string;
  videoBlob: Blob | null; // MP4 Blob
  videoResolution: '720p' | '1080p';
  includeVideo: boolean;

  // Dialogue
  dialogueScript: string;
  dialogueAudioBlob: Blob | null;
  dialogueSpeed: number;
  includeDialogueAudio: boolean;
}

export interface CourseData {
  id: string;
  title: string;
  context: string;
  globalAnalysis: string;
  isAnalysisConfirmed: boolean;
  pages: PageData[];
}

export interface AppState {
  view: AppView;
  isLoading: boolean;
  error: string | null;
  apiKey: string | null; // For sharing the app
  
  courses: CourseData[];
  activeCourseId: string | null;
  activePageIndex: number;
}

