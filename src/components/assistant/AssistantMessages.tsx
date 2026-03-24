'use client';

import { Brain, Cpu, MessageCircle, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChatContainerContent,
  ChatContainerRoot,
} from '@/components/ui/chat-container';
import { ScrollButton } from '@/components/ui/scroll-button';
import { cn } from '@/lib/utils';
import type { AssistantMessage, AssistantStage } from '@/types/taskflow';

interface AssistantMessagesProps {
  messages: AssistantMessage[];
}

const STAGE_CONFIG: Record<AssistantStage, { icon: typeof Brain; label: string; color: string }> = {
  thinking: { icon: Brain, label: 'Parsing intent...', color: 'text-blue-500' },
  executing: { icon: Cpu, label: 'Executing...', color: 'text-amber-500' },
  responding: { icon: MessageCircle, label: 'Generating response...', color: 'text-violet-500' },
  done: { icon: MessageCircle, label: '', color: '' },
  error: { icon: MessageCircle, label: '', color: '' },
};

function StageIndicator({ stage }: { stage: AssistantStage }) {
  const config = STAGE_CONFIG[stage];
  if (!config || stage === 'done' || stage === 'error') return null;
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="flex justify-start"
    >
      <div className="flex items-center gap-2 rounded-2xl bg-muted px-4 py-2.5 text-sm shadow-sm">
        <motion.div
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Icon className={cn('h-3.5 w-3.5', config.color)} />
        </motion.div>
        <span className="text-muted-foreground">{config.label}</span>
        <motion.span
          className="flex gap-0.5"
          initial="start"
          animate="end"
          variants={{
            start: {},
            end: { transition: { staggerChildren: 0.2, repeat: Infinity } },
          }}
        >
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className={cn('inline-block h-1 w-1 rounded-full', config.color, 'bg-current')}
              variants={{
                start: { opacity: 0.3 },
                end: { opacity: 1 },
              }}
              transition={{ duration: 0.4, repeat: Infinity, repeatType: 'reverse' }}
            />
          ))}
        </motion.span>
      </div>
    </motion.div>
  );
}

export function AssistantMessages({ messages }: AssistantMessagesProps) {
  // Find the last message that has an active stage (not done/error)
  const activeStageMessage = messages
    .slice()
    .reverse()
    .find((m) => m.stage && m.stage !== 'done' && m.stage !== 'error');

  return (
    <ChatContainerRoot className="relative min-h-0 flex-1">
      <ChatContainerContent className="space-y-4 p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 rounded-full bg-muted p-4">
              <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              TaskFlow Assistant
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Ask me to create, update, move, or delete tasks using natural language.
            </p>
          </div>
        ) : null}

        {messages.map((message) => {
          // Don't render assistant messages that are still in a loading stage (no content yet)
          if (message.role === 'assistant' && message.stage && message.stage !== 'done' && message.stage !== 'error' && !message.content) {
            return null;
          }

          return (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className={cn(
                'flex',
                message.role === 'user' ? 'justify-end' : 'justify-start',
              )}
            >
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm',
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground',
                  message.tone === 'muted' && 'text-muted-foreground',
                )}
              >
                {message.content}
              </div>
            </motion.div>
          );
        })}

        <AnimatePresence mode="wait">
          {activeStageMessage?.stage && (
            <StageIndicator
              key={activeStageMessage.stage}
              stage={activeStageMessage.stage}
            />
          )}
        </AnimatePresence>
      </ChatContainerContent>

      <div className="absolute bottom-4 right-4">
        <ScrollButton />
      </div>
    </ChatContainerRoot>
  );
}
