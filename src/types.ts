export interface PenNote {
  id: string;
  title: string;
  dataUrl: string;        // JPEG compressed canvas snapshot
  ocrText: string;        // ML Kit / Gemini recognized text (for search)
  createdAt: number;
  updatedAt: number;
  isPinned: boolean;
  paperType: 'white' | 'yellow' | 'black';
}
