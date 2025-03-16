// database.ts
import Dexie from 'dexie'

export type ChatRole = 'user' | 'assistant' | 'system'

export interface Config {
  id?: number
  model: string
  systemPrompt: string
  createdAt: Date
}

export interface Chat {
  id?: number
  name: string
  model: string
  createdAt: Date
  activeBranchId?: number // Track the active branch for this chat
}

export interface Message {
  id?: number
  chatId: number
  role: ChatRole
  content: string
  meta?: any
  context?: number[]
  createdAt: Date
  parentId?: number // ID of the parent message (for branching)
  branchId?: number // ID to group messages in the same branch
  order?: number // Order in the conversation
}

// Delete the existing database to resolve version conflicts
try {
  indexedDB.deleteDatabase('ChatDatabase');
  console.log('Deleted existing ChatDatabase to resolve version conflicts');
} catch (error) {
  console.error('Error deleting database:', error);
}

class ChatDatabase extends Dexie {
  chats: Dexie.Table<Chat, number>
  messages: Dexie.Table<Message, number>
  config: Dexie.Table<Config, number>

  constructor() {
    super('ChatDatabase')
    this.version(10).stores({
      chats: '++id,name,model,createdAt,activeBranchId',
      messages: '++id,chatId,role,content,meta,context,createdAt,parentId,branchId,order',
      config: '++id,model,systemPrompt,createdAt',
    })

    this.chats = this.table('chats')
    this.messages = this.table('messages')
    this.config = this.table('config')
  }
}

export const db = new ChatDatabase()
