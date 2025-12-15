
export enum AppView {
  COURSE_LIST = 'COURSE_LIST', // List of all projects
  DASHBOARD = 'DASHBOARD',     // Specific Course Setup & Analysis
  EDITOR = 'EDITOR',           // Page Editing
  PLAYER = 'PLAYER'            // Final View (Preview mode inside app)
}

export interface PageData {
  id: string;
  pageNumber: number;
  
  // Visuals (Now stored as filenames on disk)
  imageFilename: string | null; 
  
  // Base Content & Analysis
  aiAnalysis: string;       
  extractedText: string;    
  imageDescription: string; 
  
  // Teacher
  teacherScript: string;
  teacherAudioFilename: string | null; // Filename on disk
  teacherVoice: string;
  teacherAudioSpeed: number; 
  includeTeacherAudio: boolean;

  // Storyboard
  storyboardPrompt: string;
  storyboardImageFilename: string | null; // Filename on disk
  includeStoryboard: boolean;

  // Video (Veo)
  videoPrompt: string;
  videoFilename: string | null; // Filename on disk
  videoResolution: '720p' | '1080p';
  includeVideo: boolean;

  // Dialogue
  dialogueScript: string;
  dialogueAudioFilename: string | null; // Filename on disk
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
  apiKey: string | null;
  
  courses: CourseData[];
  activeCourseId: string | null;
  activePageIndex: number;
  
  // Runtime handle for File System Access (not persisted in localStorage)
  projectHandle: FileSystemDirectoryHandle | null;
}
