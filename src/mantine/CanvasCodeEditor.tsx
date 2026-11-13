import {useEffect, useRef} from 'react';
import Editor, {loader, type OnMount} from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import {canvasDiagnostics} from '../../shared/canvas-authoring.mjs';

// The editor and its language services are bundled with Rayloom, including offline builds.
self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (['html', 'handlebars', 'razor'].includes(label)) return new HtmlWorker();
    if (['css', 'scss', 'less'].includes(label)) return new CssWorker();
    if (['typescript', 'javascript'].includes(label)) return new TypeScriptWorker();
    return new EditorWorker();
  },
};
loader.config({monaco});
monaco.editor.defineTheme('rayloom-quiet', {
  base:'vs-dark', inherit:true,
  rules:[{token:'comment', foreground:'7f8983'}, {token:'tag', foreground:'b7cd83'}, {token:'attribute.name', foreground:'c5b8dc'}, {token:'string', foreground:'d9bb8c'}],
  colors:{'editor.background':'#191c1e','editor.foreground':'#e7e8e2','editorLineNumber.foreground':'#626a65','editorLineNumber.activeForeground':'#b7cd83','editor.selectionBackground':'#56654666','editor.inactiveSelectionBackground':'#56654633','editor.lineHighlightBackground':'#ffffff05','editorCursor.foreground':'#b7cd83','editorWidget.background':'#24282a','editorWidget.border':'#3a403c','editorSuggestWidget.background':'#24282a','editorSuggestWidget.border':'#3a403c','editorSuggestWidget.selectedBackground':'#3a4232'},
});

export type CanvasDiagnostic={message:string;line:number;column:number;severity:'error'|'warning'};
export type CanvasReveal={line:number;column:number;request:number};
type Props = {value:string; onChange:(value:string)=>void; onPreview:()=>void; onSave:()=>void; fontSize?:number; wordWrap?:boolean;onDiagnostics?:(value:{source:string;items:CanvasDiagnostic[]})=>void;reveal?:CanvasReveal};
export default function CanvasCodeEditor({value,onChange,onPreview,onSave,fontSize=14,wordWrap=true,onDiagnostics,reveal}:Props) {
  const callbacks=useRef({onPreview,onSave,onDiagnostics}); callbacks.current={onPreview,onSave,onDiagnostics};
  const editorRef=useRef<monaco.editor.IStandaloneCodeEditor|null>(null);
  const revealPosition=(position:CanvasReveal|undefined)=>{const editor=editorRef.current,model=editor?.getModel();if(!editor||!model||!position)return;const target=model.validatePosition({lineNumber:position.line,column:position.column});editor.setPosition(target);editor.revealPositionInCenter(target);editor.focus();};
  useEffect(()=>{revealPosition(reveal);},[reveal]);
  useEffect(()=>()=>{editorRef.current=null;},[]);
  const mount:OnMount = editor => {
    editorRef.current=editor;revealPosition(reveal);
    editor.addAction({id:'rayloom-preview',label:'Rayloom: предпросмотр эффекта',keybindings:[monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],run:()=>callbacks.current.onPreview()});
    editor.addAction({id:'rayloom-save',label:'Rayloom: сохранить эффект',keybindings:[monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],run:()=>callbacks.current.onSave()});
  };
  return <Editor value={value} onChange={next=>onChange(next??'')} language="html" theme="rayloom-quiet" height="100%" onMount={mount} onValidate={markers=>{const model=editorRef.current?.getModel();if(model)callbacks.current.onDiagnostics?.({source:model.getValue(),items:canvasDiagnostics(markers,model.getVersionId())});}} loading={<div className="rayloom-code-loading" role="status">Открываем редактор кода…</div>} options={{ariaLabel:'HTML-код эффекта',automaticLayout:true,fontSize,lineHeight:Math.round(fontSize*1.57),fontFamily:'Cascadia Code, Consolas, monospace',minimap:{enabled:false},padding:{top:18,bottom:18},scrollBeyondLastLine:false,wordWrap:wordWrap?'on':'off',tabSize:2,insertSpaces:true,renderWhitespace:'selection',roundedSelection:true,folding:true,formatOnPaste:true,quickSuggestions:{other:true,comments:false,strings:true},suggestOnTriggerCharacters:true,stickyScroll:{enabled:false},bracketPairColorization:{enabled:true},accessibilitySupport:'auto'}}/>;
}
