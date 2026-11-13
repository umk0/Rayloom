import {Component,type ReactNode} from 'react';
import {Button} from '@heroui/react';
import {WindowTitlebar} from './WindowTitlebar';

export class AdvancedBoundary extends Component<{children:ReactNode;onBack:()=>void},{error:string}>{
 state={error:''};
 static getDerivedStateFromError(error:unknown){return {error:String(error)};}
 render(){
  if(!this.state.error)return this.props.children;
  return <div className="studio"><WindowTitlebar title="Расширенные настройки"/><main className="advanced-error-panel"><h1>Не удалось открыть настройки эффекта</h1><p>Можно вернуться к своей подсветке. Сохранённые сцены остаются на месте.</p><Button onPress={this.props.onBack}>Вернуться к подсветке</Button><details><summary>Подробности ошибки</summary><pre>{this.state.error}</pre></details></main></div>;
 }
}
