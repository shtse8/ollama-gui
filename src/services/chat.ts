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

  // Methods for state mutations
  const setActiveChat = (chat: Chat) => (activeChat.value = chat)
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
        const chatMessages = await dbLayer.getMessages(chatId)
        setMessages(chatMessages)
        if (activeChat.value) {
          await switchModel(activeChat.value.model)
        }
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
    console.log('Adding user message:', content)
    
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
      console.log('Saving message to database...')
      message.id = await dbLayer.addMessage(message)
      console.log('Message saved with ID:', message.id)
      
      messages.value.push(message)
      console.log('Message added to UI, messages count:', messages.value.length)

      console.log('Generating AI response...')
      await generate(
        currentModel.value,
        messages.value,
        systemPrompt.value,
        historyMessageLength.value,
        (data) => {
          console.log('Partial response received:', data.message.content.substring(0, 20) + '...')
          handleAiPartialResponse(data, currentChatId)
        },
        (data) => {
          console.log('Response completed')
          handleAiCompletion(data, currentChatId)
        },
      )
      console.log('AI response generation completed')
      return true
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          console.log('Request aborted')
          ongoingAiMessages.value.delete(currentChatId)
          return
        }
      }

      console.error('Failed to add user message:', error)
      throw error
    }
  }

  const regenerateResponse = async () => {
    if (!activeChat.value) return
    const currentChatId = activeChat.value.id!
    const message = messages.value[messages.value.length - 1]
    if (message && message.role === 'assistant') {
      if (message.id) db.messages.delete(message.id)
      messages.value.pop()
    }
    try {
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
      console.error('Failed to regenerate response:', error)
    }
  }

  const handleAiPartialResponse = (data: ChatPartResponse, chatId: number) => {
    console.log('Handling partial response for chat ID:', chatId)
    
    if (ongoingAiMessages.value.has(chatId)) {
      console.log('Appending to existing AI message')
      appendToAiMessage(data.message.content, chatId)
    } else {
      console.log('Starting new AI message')
      startAiMessage(data.message.content, chatId)
    }
  }

  const handleAiCompletion = async (data: ChatCompletedResponse, chatId: number) => {
    console.log('Handling completion for chat ID:', chatId)
    
    const aiMessage = ongoingAiMessages.value.get(chatId)
    if (aiMessage) {
      try {
        console.log('Finalizing AI message with ID:', aiMessage.id)
        ongoingAiMessages.value.delete(chatId)
      } catch (error) {
        console.error('Failed to finalize AI message:', error)
      }
    } else {
      console.error('No ongoing message to finalize for chat ID:', chatId)
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

  const startAiMessage = async (initialContent: string, chatId: number) => {
    console.log('Starting AI message for chat ID:', chatId)
    
    const message: Message = {
      chatId: chatId,
      role: 'assistant',
      content: initialContent,
      createdAt: new Date(),
    }

    try {
      console.log('Saving AI message to database...')
      message.id = await dbLayer.addMessage(message)
      console.log('AI message saved with ID:', message.id)
      
      ongoingAiMessages.value.set(chatId, message)
      console.log('Added message to ongoingAiMessages map')
      
      messages.value.push(message)
      console.log('Added message to UI, messages count:', messages.value.length)
    } catch (error) {
      console.error('Failed to start AI message:', error)
    }
  }

  const appendToAiMessage = async (content: string, chatId: number) => {
    console.log('Appending to AI message for chat ID:', chatId)
    
    const aiMessage = ongoingAiMessages.value.get(chatId)
    if (aiMessage) {
      console.log('Found ongoing AI message with ID:', aiMessage.id)
      aiMessage.content += content
      
      try {
        console.log('Updating AI message in database...')
        await dbLayer.updateMessage(aiMessage.id!, { content: aiMessage.content })
        console.log('AI message updated in database')

        // Only "load the messages" if we are on this chat atm.
        if (chatId == activeChat.value?.id) {
          console.log('Reloading messages for active chat')
          setMessages(await dbLayer.getMessages(chatId))
          console.log('Messages reloaded, count:', messages.value.length)
        }
      } catch (error) {
        console.error('Failed to append to AI message:', error)
      }
    } else {
      console.error('No ongoing AI message found for chat ID:', chatId)
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

  const editMessage = async (messageId: number, newContent: string) => {
    console.log('Editing message with ID:', messageId)
    console.log('New content:', newContent)
    
    if (!activeChat.value) {
      console.error('No active chat found')
      return
    }
    
    try {
      console.log('Updating message in database...')
      // Update the message in the database
      await dbLayer.updateMessage(messageId, { content: newContent })
      console.log('Message updated in database')
      
      // Update the message in the UI
      const index = messages.value.findIndex(m => m.id === messageId)
      console.log('Message index in UI array:', index)
      
      if (index !== -1) {
        console.log('Updating message in UI')
        messages.value[index].content = newContent
        console.log('Message updated in UI')
        
        // If this is not the last message, we need to remove all subsequent messages
        // as they would no longer make sense in the conversation
        if (index < messages.value.length - 1) {
          console.log('Message is not the last one, removing subsequent messages')
          const subsequentMessages = messages.value.slice(index + 1)
          console.log('Subsequent messages count:', subsequentMessages.length)
          
          // Delete subsequent messages from the database
          for (const msg of subsequentMessages) {
            if (msg.id) {
              console.log('Deleting message with ID:', msg.id)
              await dbLayer.deleteMessage(msg.id)
              console.log('Message deleted from database')
            }
          }
          
          // Remove subsequent messages from the UI
          console.log('Removing subsequent messages from UI')
          messages.value = messages.value.slice(0, index + 1)
          console.log('Messages after removal:', messages.value.length)
        } else {
          console.log('Message is the last one, no need to remove subsequent messages')
        }
      } else {
        console.error('Message not found in UI array')
      }
    } catch (error) {
      console.error(`Failed to edit message with ID ${messageId}:`, error)
      throw error
    }
  }

  return {
    chats,
    sortedChats,
    activeChat,
    messages,
    hasMessages,
    hasActiveChat,
    renameChat,
    switchModel,
    startNewChat,
    switchChat,
    deleteChat,
    addUserMessage,
    regenerateResponse,
    addSystemMessage,
    initialize,
    wipeDatabase,
    abort,
    exportChats,
    importChats,
    editMessage
  }
}
