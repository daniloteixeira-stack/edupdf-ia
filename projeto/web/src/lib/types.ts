export type AppRole = "admin" | "student";
export type AccountStatus = "active" | "paused" | "blocked";
export type QuestionType = "multiple_choice" | "open";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  status: AccountStatus;
  status_reason: string | null;
  status_changed_at: string | null;
  must_change_password: boolean;
  signup_platform: string;
  last_sign_in_at: string | null;
  last_sign_in_platform: string | null;
  created_at: string;
}

export interface PdfFile {
  id: string;
  title: string;
  original_name: string;
  storage_path: string;
  size_bytes: number;
  page_count: number | null;
  char_count: number;
  status: "processing" | "ready" | "error";
  error_message: string | null;
  created_at: string;
}

export interface Module {
  id: string;
  title: string;
  description: string | null;
  pdf_file_id: string | null;
  is_published: boolean;
  audience: "all" | "selected";
  pass_score: number;
  max_attempts: number;
  shuffle_options: boolean;
  created_at: string;
}

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  module_id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  points: number;
  source_page: number | null;
}

export interface QuestionKey {
  question_id: string;
  correct_option_id: string | null;
  explanation: string | null;
  expected_answer: string | null;
  key_points: string[];
  source_excerpt: string | null;
}

export interface StudentAnswer {
  id: string;
  question_id: string;
  module_id: string;
  student_id: string;
  attempt: number;
  selected_option_id: string | null;
  answer_text: string | null;
  score: number;
  is_correct: boolean;
  feedback: string | null;
  feedback_details: {
    verdict?: string;
    correct_points?: string[];
    missing_points?: string[];
    incorrect_points?: string[];
  };
  graded_by: "auto" | "ai";
  created_at: string;
}

export interface McResult {
  is_correct: boolean;
  score: number;
  correct_option_id: string | null;
  explanation: string | null;
  attempt: number;
  attempts_left: number;
}

export interface OpenGrade {
  score: number;
  verdict: "correta" | "parcialmente_correta" | "incorreta";
  feedback: string;
  correct_points: string[];
  missing_points: string[];
  incorrect_points: string[];
  attempt: number;
  attempts_left: number;
}

export interface AccessLog {
  id: number;
  user_id: string;
  event: "sign_in" | "sign_out" | "signup" | "password_changed" | "blocked_attempt";
  platform: "desktop" | "web";
  user_agent: string | null;
  created_at: string;
}
