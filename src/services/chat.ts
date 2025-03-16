import { computed, ref } from 'vue'
import { Chat, db, Message } from './database'
import { historyMessageLength, currentModel, useConfig } from './appConfig'
import { useAI } from './useAI.ts'
import { ChatCompletedResponse, ChatPartResponse, useApi } from './api.ts'

interface ChatExport extends Chat {
  messages: Message[]
}

// State
const chats = ref<Chat[]>([])
const activeChat = ref<Chat | null>(null)
const messages = ref<Message[]>([])
const systemPrompt = ref<Message>()
const ongoingAiMessages = ref<Map<number, Message>>(new Map())
const activeBranch = ref<number | undefined>(undefined)
const branches = ref<Map<number, Message[]>>(new Map()) // Map of branchId to messages

// Database Layer
const dbLayer = {
  async getAllChats() {
    return db.chats.toArray()
  },

  async getChat(chatId: number) {
    return db.chats.get(chatId)
  },

  async getMessages(chatId: number) {
    return db.messages.where('chatId').equals(chatId).toArray()
  },

  async addChat(chat: Chat) {
    return db.chats.add(chat)
  },

  async updateChat(chatId: number, updates: Partial<Chat>) {
    return db.chats.update(chatId, updates)
  },

  async addMessage(message: Message) {
    return db.messages.add(message)
  },

  async updateMessage(messageId: number, updates: Partial<Message>) {
    return db.messages.update(messageId, updates)
  },

  async deleteChat(chatId: number) {
    return db.chats.delete(chatId)
  },

  async deleteMessagesOfChat(chatId: number) {
    return db.messages.where('chatId').equals(chatId).delete()
  },

  async deleteMessage(messageId: number) {
    return db.messages.delete(messageId)
  },

  async clearChats() {
    return db.chats.clear()
  },

  async clearMessages() {
    return db.messages.clear()
  },

  async getMessagesInBranch(chatId: number, branchId: number) {
    return db.messages
      .where('chatId')
      .equals(chatId)
      .and(message => message.branchId === branchId)
      .sortBy('order')
  },

  async getMessageBranches(chatId: number, messageId: number) {
    return db.messages
      .where('chatId')
      .equals(chatId)
      .and(message => message.parentId === messageId)
      .toArray()
  },

  async updateChatActiveBranch(chatId: number, branchId: number) {
    return db.chats.update(chatId, { activeBranchId: branchId })
  }
}

export function useChats() {
  const { generate } = useAI()
  const { abort } = useApi()

  // Computed
  const sortedChats = computed<Chat[]>(() =>
    [...chats.value].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  )
  const hasActiveChat = computed(() => activeChat.value !== null)
  const hasMessages = computed(() => messages.value.length > 0)
  const availableBranches = computed(() => {
    if (!activeChat.value) return []
    
    // Group messages by branchId
    const branchMap = new Map<number, Message[]>()
    messages.value.forEach(msg => {
      if (msg.branchId) {
        if (!branchMap.has(msg.branchId)) {
          branchMap.set(msg.branchId, [])
        }
        branchMap.get(msg.branchId)!.push(msg)
      }
    })
    
    // Convert to array of branch objects
    return Array.from(branchMap.entries()).map(([id, msgs]) => ({
      id,
      messages: msgs,
      isActive: id === activeBranch.value
    }))
  })

  // Methods for state mutations
  const setActiveChat = (chat: Chat) => {
    activeChat.value = chat
    activeBranch.value = chat.activeBranchId
  }
  const setMessages = (newMessages: Message[]) => (messages.value = newMessages)

  const initialize = async () => {
    try {
      chats.value = await dbLayer.getAllChats()
      if (chats.value.length > 0) {
        await switchChat(sortedChats.value[0].id!)
      } else {
        await startNewChat('New chat')
      }
    } catch (error) {
      console.error('Failed to initialize chats:', error)
    }
  }

  const switchChat = async (chatId: number) => {
    try {
      const chat = await dbLayer.getChat(chatId)
      if (chat) {
        setActiveChat(chat)
        
        // Load messages for the active branch if set, otherwise load all messages
        if (chat.activeBranchId) {
          const branchMessages = await dbLayer.getMessagesInBranch(chatId, chat.activeBranchId)
          setMessages(branchMessages)
        } else {
          const allMessages = await dbLayer.getMessages(chatId)
          setMessages(allMessages)
        }
        
        // Set system prompt
        systemPrompt.value = messages.value.find((m) => m.role === 'system')
      }
    } catch (error) {
      console.error(`Failed to switch to chat with ID ${chatId}:`, error)
    }
  }

  const switchModel = async (model: string) => {
    currentModel.value = model
    if (!activeChat.value) return

    try {
      await dbLayer.updateChat(activeChat.value.id!, { model })
      activeChat.value.model = model
    } catch (error) {
      console.error(`Failed to switch model to ${model}:`, error)
    }
  }

  const renameChat = async (newName: string) => {
    if (!activeChat.value) return

    activeChat.value.name = newName
    await dbLayer.updateChat(activeChat.value.id!, { name: newName })
    chats.value = await dbLayer.getAllChats()
  }

  const startNewChat = async (name: string) => {
    const newChat: Chat = {
      name,
      model: currentModel.value,
      createdAt: new Date(),
    }

    try {
      newChat.id = await dbLayer.addChat(newChat)
      chats.value.push(newChat)
      setActiveChat(newChat)
      setMessages([])
      await addSystemMessage(await useConfig().getCurrentSystemMessage())
    } catch (error) {
      console.error('Failed to start a new chat:', error)
    }
  }

  const addSystemMessage = async (content: string | null, meta?: any) => {
    if (!activeChat.value) return
    if (!content) return

    const systemPromptMessage: Message = {
      chatId: activeChat.value.id!,
      role: 'system',
      content,
      meta,
      createdAt: new Date(),
    }

    systemPromptMessage.id = await dbLayer.addMessage(systemPromptMessage)
    messages.value.push(systemPromptMessage)

    systemPrompt.value = systemPromptMessage
  }

  const addUserMessage = async (content: string) => {
    if (!activeChat.value) {
      console.warn('There was no active chat.')
      return
    }

    const currentChatId = activeChat.value.id!
    const message: Message = {
      chatId: activeChat.value.id!,
      role: 'user',
      content,
      createdAt: new Date(),
    }

    try {
      message.id = await dbLayer.addMessage(message)
      messages.value.push(message)

      await generate(
        currentModel.value,
        messages.value,
        systemPrompt.value,
        historyMessageLength.value,
        (data) => handleAiPartialResponse(data, currentChatId),
        (data) => handleAiCompletion(data, currentChatId),
      )
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          ongoingAiMessages.value.delete(currentChatId)
          return
        }
      }

      console.error('Failed to add user message:', error)
    }
  }

  const regenerateResponse = async () => {
    if (!activeChat.value) return
    const currentChatId = activeChat.value.id!
    
    // Find the last assistant message
    const lastAssistantMessageIndex = [...messages.value].reverse().findIndex(m => m.role === 'assistant')
    if (lastAssistantMessageIndex === -1) return
    
    const lastAssistantMessage = messages.value[messages.value.length - 1 - lastAssistantMessageIndex]
    
    // Find the parent user message
    const parentMessage = messages.value.find(m => m.id === lastAssistantMessage.parentId)
    if (!parentMessage) return
    
    // Create a new branch from the parent message
    const newBranchId = await createNewBranch(parentMessage.id!)
    if (!newBranchId) return
    
    // Get messages in the new branch
    const branchMessages = await dbLayer.getMessagesInBranch(currentChatId, newBranchId)
    
    try {
      await generate(
        currentModel.value,
        branchMessages,
        systemPrompt.value,
        historyMessageLength.value,
        (data) => handleAiPartialResponse(data, currentChatId, newBranchId),
        (data) => handleAiCompletion(data, currentChatId, newBranchId),
      )
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          ongoingAiMessages.value.delete(currentChatId)
          return
        }
      }
      console.error('Failed to regenerate response:', error)
    }
  }

  // Modified to support branches
  const handleAiPartialResponse = (data: ChatPartResponse, chatId: number, branchId?: number) => {
    if (ongoingAiMessages.value.has(chatId)) {
      appendToAiMessage(data.message.content, chatId)
    } else {
      startAiMessage(data.message.content, chatId, branchId)
    }
  }

  const handleAiCompletion = async (data: ChatCompletedResponse, chatId: number, branchId?: number) => {
    const aiMessage = ongoingAiMessages.value.get(chatId)
    if (aiMessage) {
      try {
        ongoingAiMessages.value.delete(chatId)
      } catch (error) {
        console.error('Failed to finalize AI message:', error)
      }
    } else {
      console.error('no ongoing message to finalize:')
      debugger
    }
  }

  const wipeDatabase = async () => {
    try {
      await dbLayer.clearChats()
      await dbLayer.clearMessages()

      // Reset local state
      chats.value = []
      activeChat.value = null
      messages.value = []
      ongoingAiMessages.value.clear()

      await startNewChat('New chat')
    } catch (error) {
      console.error('Failed to wipe the database:', error)
    }
  }

  const deleteChat = async (chatId: number) => {
    try {
      await dbLayer.deleteChat(chatId)
      await dbLayer.deleteMessagesOfChat(chatId)

      chats.value = chats.value.filter((chat) => chat.id !== chatId)

      if (activeChat.value?.id === chatId) {
        if (sortedChats.value.length) {
          await switchChat(sortedChats.value[0].id!)
        } else {
          await startNewChat('New chat')
        }
      }
    } catch (error) {
      console.error(`Failed to delete chat with ID ${chatId}:`, error)
    }
  }

  // Modified to support branches
  const startAiMessage = async (initialContent: string, chatId: number, branchId?: number) => {
    const message: Message = {
      chatId: chatId,
      role: 'assistant',
      content: initialContent,
      createdAt: new Date(),
      branchId: branchId || activeBranch.value,
      order: messages.value.length
    }
    
    // Set parent ID if there's a previous message
    const userMessages = messages.value.filter(m => m.role === 'user')
    if (userMessages.length > 0) {
      message.parentId = userMessages[userMessages.length - 1].id
    }

    try {
      message.id = await dbLayer.addMessage(message)
      messages.value.push(message)
      ongoingAiMessages.value.set(chatId, message)
    } catch (error) {
      console.error('Failed to start AI message:', error)
    }
  }

  const appendToAiMessage = async (content: string, chatId: number) => {
    const aiMessage = ongoingAiMessages.value.get(chatId)
    if (aiMessage) {
      aiMessage.content += content
      try {
        await dbLayer.updateMessage(aiMessage.id!, { content: aiMessage.content })

        // Only "load the messages" if we are on this chat atm.
        if (chatId == activeChat.value?.id) {
          setMessages(await dbLayer.getMessages(chatId))
        }
      } catch (error) {
        console.error('Failed to append to AI message:', error)
      }
    } else {
      console.log('No ongoing AI message?')
    }
  }

  const exportChats = async () => {
    const chats = await dbLayer.getAllChats()
    const exportData: ChatExport[] = []
    await Promise.all(chats.map(async chat => {
      if (!chat?.id) return
      const messages = await dbLayer.getMessages(chat.id)
      exportData.push(Object.assign({ messages }, chat))
    }))
    return exportData
  }

  const importChats = async (jsonData: ChatExport[]) => {
    jsonData.forEach(async chatData => {
      const chat: Chat = {
        name: chatData?.name,
        model: chatData?.model,
        createdAt: new Date(chatData?.createdAt || chatData.messages[0].createdAt),
      }
      chat.id = await dbLayer.addChat(chat)
      chats.value.push(chat)
      chatData.messages.forEach(async messageData => {
        const message: Message = {
          chatId: chat.id!,
          role: messageData.role,
          content: messageData.content,
          createdAt: new Date(messageData.createdAt),
        }
        await dbLayer.addMessage(message)
      })
    })
  }

  const switchBranch = async (branchId: number) => {
    if (!activeChat.value) return
    
    try {
      // Update active branch in database
      await dbLayer.updateChatActiveBranch(activeChat.value.id!, branchId)
      
      // Update active branch in memory
      activeChat.value.activeBranchId = branchId
      activeBranch.value = branchId
      
      // Load messages for this branch
      const branchMessages = await dbLayer.getMessagesInBranch(activeChat.value.id!, branchId)
      setMessages(branchMessages)
    } catch (error) {
      console.error(`Failed to switch to branch with ID ${branchId}:`, error)
    }
  }

  const createNewBranch = async (parentMessageId: number) => {
    if (!activeChat.value) return
    
    try {
      // Generate a new branch ID (using timestamp for simplicity)
      const newBranchId = Date.now()
      
      // Get all messages up to and including the parent message
      const allMessages = await dbLayer.getMessages(activeChat.value.id!)
      const parentIndex = allMessages.findIndex(m => m.id === parentMessageId)
      
      if (parentIndex === -1) {
        console.error(`Parent message with ID ${parentMessageId} not found`)
        return
      }
      
      // Get messages up to the parent message
      const messagesUpToParent = allMessages.slice(0, parentIndex + 1)
      
      // Create copies of these messages with the new branch ID
      const branchMessages: Message[] = []
      
      for (let i = 0; i < messagesUpToParent.length; i++) {
        const originalMsg = messagesUpToParent[i]
        
        // Skip system messages as they're shared across branches
        if (originalMsg.role === 'system') {
          branchMessages.push(originalMsg)
          continue
        }
        
        // Create a copy with the new branch ID
        const msgCopy: Message = {
          ...originalMsg,
          id: undefined, // Let the database assign a new ID
          branchId: newBranchId,
          order: i
        }
        
        // Save to database
        const newId = await dbLayer.addMessage(msgCopy)
        msgCopy.id = newId
        branchMessages.push(msgCopy)
      }
      
      // Switch to the new branch
      await switchBranch(newBranchId)
      
      return newBranchId
    } catch (error) {
      console.error(`Failed to create new branch from message ${parentMessageId}:`, error)
    }
  }

  const regenerateMessageWithBranch = async (messageId: number) => {
    if (!activeChat.value) return
    
    try {
      // Find the message
      const messageToRegenerate = messages.value.find(m => m.id === messageId)
      if (!messageToRegenerate) {
        console.error(`Message with ID ${messageId} not found`)
        return
      }
      
      // Create a new branch from the parent message
      const parentMessage = messages.value.find(m => m.id === messageToRegenerate.parentId)
      if (!parentMessage) {
        console.error(`Parent message not found for message ${messageId}`)
        return
      }
      
      const newBranchId = await createNewBranch(parentMessage.id!)
      if (!newBranchId) return
      
      // Get all messages in the new branch
      const branchMessages = await dbLayer.getMessagesInBranch(activeChat.value.id!, newBranchId)
      
      // Generate a new response
      await generate(
        currentModel.value,
        branchMessages,
        systemPrompt.value,
        historyMessageLength.value,
        (data) => handleAiPartialResponse(data, activeChat.value!.id!, newBranchId),
        (data) => handleAiCompletion(data, activeChat.value!.id!, newBranchId),
      )
      
      return newBranchId
    } catch (error) {
      console.error(`Failed to regenerate message ${messageId} with new branch:`, error)
    }
  }

  return {
    chats,
    sortedChats,
    activeChat,
    messages,
    systemPrompt,
    hasActiveChat,
    hasMessages,
    ongoingAiMessages,
    availableBranches,
    activeBranch,
    
    initialize,
    startNewChat,
    switchChat,
    addUserMessage,
    regenerateResponse,
    abort,
    wipeDatabase,
    deleteChat,
    renameChat,
    exportChats,
    importChats,
    switchBranch,
    createNewBranch,
    regenerateMessageWithBranch
  }
}
