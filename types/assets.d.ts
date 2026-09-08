declare module '*.html' {
  const content: string;
  export default content;
}
declare module '*.css' {
  const content: string;
  export default content;
}
declare module 'markdown-it-task-lists' {
  import type { MarkdownIt } from 'markdown-it';
  const taskLists: (md: MarkdownIt) => void;
  export default taskLists;
}
