import type {ReactElement, ReactNode} from 'react';
export type JarvisState = 'idle' | 'greeting' | 'attentive' | 'typing' | 'thinking' | 'reply' | 'error' | 'dragging' | 'sleep' | 'sleeping' | 'listening' | 'speaking' | 'searching' | 'working' | 'happy' | 'hearts' | 'money' | 'cool' | 'reply-hearts' | 'reply-money' | 'reply-cool';
export interface JarvisRobotTheme {color: string; trimColor: string; screenColor: string;}
export interface JarvisMessage {conversationId?: string; id: string; time: number; user: string; text: string;}
export type JarvisSend = (message: string, context: {messages: JarvisMessage[]; signal: AbortSignal}) => Promise<string>;
export interface JarvisWidgetProps {
  onSend?: JarvisSend;
  onOpenPage?: () => void;
  onPopOut?: () => void | Promise<void>;
  hidden?: boolean;
  storageKey?: string;
  messagePrefix?: string;
  accent?: string;
  robotTheme?: JarvisRobotTheme;
  characterStyle?: 'robot' | 'head' | 'sprite';
  welcome?: ReactNode | ReactNode[];
  serviceLabel?: string;
  mobileBottomOffset?: number;
}
export function JarvisWidget(props: JarvisWidgetProps): ReactElement | null;
export function JarvisCharacter(props: {state?: JarvisState; hovered?: boolean; activityId?: number; paused?: boolean; robotTheme?: JarvisRobotTheme; characterStyle?: 'robot' | 'head' | 'sprite'}): ReactElement;
export function JarvisChat(props: {storagePrefix?: string; onSend?: JarvisSend; onStateChange?: (state: JarvisState) => void; welcome?: ReactNode | ReactNode[]; serviceLabel?: string; paused?: boolean; showCharacter?: boolean; conversationId?: string; readOnly?: boolean; robotTheme?: JarvisRobotTheme; characterStyle?: 'robot' | 'head' | 'sprite'}): ReactElement;

export function JarvisConversation(props: {storagePrefix?: string; onSend?: JarvisSend; onStateChange?: (state: JarvisState) => void; welcome?: ReactNode | ReactNode[]; serviceLabel?: string; conversationId?: string; readOnly?: boolean; robotTheme?: JarvisRobotTheme; characterStyle?: 'robot' | 'head' | 'sprite'}): ReactElement;

export function createPresetResponder(): JarvisSend;

export function JarvisAssistantHub(props: {storagePrefix?: string; onSend?: JarvisSend; welcome?: ReactNode | ReactNode[]; serviceLabel?: string; robotTheme?: JarvisRobotTheme; characterStyle?: 'robot' | 'head' | 'sprite'}): ReactElement;

export function JarvisSpriteCharacter(props: {state?: JarvisState; hovered?: boolean; activityId?: number; paused?: boolean}): ReactElement;
