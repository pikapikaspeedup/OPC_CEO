# Product Specification: Tiny Note-Taking Web App

## 1. Project Objective
Build a tiny note-taking web app with note CRUD operations, local persistence, and a simple smoke test. Keep the scope intentionally small for this dry-run.

## 2. User Scenarios and Pain Points
- **User Personas**: Developers or daily users needing a lightweight tool to quickly jot down thoughts, code snippets, or fleeting ideas without relying on a bulky, cloud-synced text editor.
- **Pain Points**: Current solutions are often too complex, require online accounts to function, or suffer from slow load times. Users need a reliable, fast, local-first scratchpad that prevents data loss upon accidental page refreshes.

## 3. Current State Analysis
- **Greenfield Status**: This is an entirely greenfield project. There is currently no existing codebase, product, or capability baseline. The implementation will start from scratch.

## 4. Target Experience & User Journey
- **Opening the App (Empty State)**: The user navigates to the web app in their browser. If there are no saved notes, they see a clean, minimalist UI with a friendly empty state message (e.g., "No notes yet. Create one above!") and a prominent input text box to create a new note.
- **Creating a Note**: The user types a note into the text area and clicks a "Save" button or presses "Enter". The new note is instantly visible in the note list below the input field, and the empty state message disappears.
- **Empty or Blank Note Validation**: If the user attempts to save a note without typing any text (or only whitespace), the input is rejected. A visual validation message or alert informs them that "A note cannot be empty."
- **Reading a Note**: The user can view all previously created notes in a clear, scrollable list.
- **Updating a Note**: The user clicks an "Edit" button next to an existing note, modifies the text in an input field inline, and clicks "Update" to confirm and save the changes.
- **Deleting a Note**: The user clicks a "Delete" button next to an existing note. The application instantly removes that note from the list. If it was the last note, the empty state message reappears.
- **Page Refresh Resilience**: The user refreshes the browser or closes and reopens the tab. All previously saved notes reappear exactly as they were left, seamlessly loaded from local storage.

## 5. Scope Boundaries
- **In Scope**:
  - Web client UI (HTML/CSS/JS).
  - Note creation, reading, updating (editing), and deletion (CRUD).
  - Validation for empty/blank note submissions.
  - Empty state UI when no notes are present.
  - Local browser persistence mechanism (via `localStorage`).
  - Simple automated smoke tests (e.g., DOM-based or Playwright).
- **Out of Scope**:
  - Backend database or cloud synchronization.
  - User authentication or multi-domain sessions.
  - Rich text formatting (Markdown, bold, italics, etc.).
  - Tagging, folders, categories, or complex organization.
  - Search, sorting, or filtering functionality.

## 6. Testable Acceptance Criteria
1. **App Loading (Empty)**: When the application loads with no existing notes, a specific empty state message is displayed.
2. **Creation Validation**: Attempting to save a blank or whitespace-only note prevents creation and displays an error/validation message.
3. **Creation Success**: A user can type text in an input field, click "Add Note", and the note successfully mounts and displays in the UI list, removing the empty state message if this is the first note.
4. **Reading**: The UI list accurately displays all properly created notes.
5. **Updating**: A user can trigger an edit on an existing note, modify the text, confirm, and verify the new text permanently replaces the old text in the list.
6. **Deletion**: A user can remove a note via a "Delete" action button, and it immediately disappears from the UI entirely. Deleting the last visible note re-displays the empty state message.
7. **Persistence**: If the user creates notes, reloads the browser tab completely, the previously created notes load asynchronously or synchronously from `localStorage` and display correctly without the empty state message.
