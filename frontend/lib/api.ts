import axios from 'axios';
import Cookies from 'js-cookie';

const API_URL = '/api/v1';

function readToken() {
  if (typeof window === 'undefined') {
    return Cookies.get('token');
  }

  return Cookies.get('token') || window.localStorage.getItem('token') || undefined;
}

function clearToken() {
  Cookies.remove('token', { path: '/' });
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('token');
  }
}

export function getApiErrorMessage(error: any, fallback: string) {
  const payload = error?.response?.data;

  if (typeof payload === 'string') {
    if (payload.includes('<!DOCTYPE') || payload.includes('<html')) {
      return 'The service is temporarily unavailable. Please try again shortly.';
    }
    return payload;
  }

  if (Array.isArray(payload?.message)) {
    return payload.message.join(', ');
  }

  return payload?.message || fallback;
}

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const token = readToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearToken();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export const authApi = {
  sendRegistrationCode: (email: string) => api.post('/auth/send-registration-code', { email }),
  register: (data: { email: string; username: string; password: string; verificationCode: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) => api.post('/auth/login', data),
  getApiKeys: () => api.get('/auth/api-keys'),
  createApiKey: (data: { name: string; dailyLimit?: number; monthlyLimit?: number }) =>
    api.post('/auth/api-keys', data),
  updateApiKey: (id: string, data: any) => api.put(`/auth/api-keys/${id}`, data),
  deleteApiKey: (id: string) => api.delete(`/auth/api-keys/${id}`),
};

export const userApi = {
  getProfile: () => api.get('/user/profile'),
  getBalance: () => api.get('/user/balance'),
  updateProfile: (data: { email: string; username: string }) => api.put('/user/profile', data),
  changePassword: (data: { currentPassword: string; newPassword: string }) => api.put('/user/password', data),
};

export const rechargeApi = {
  getMethods: () => api.get('/recharge/methods'),
  getPackages: () => api.get('/recharge/packages'),
  createRecharge: (
    amount: number,
    paymentMethod: 'stripe' | 'alipay' | 'wechat' | 'paypal' | 'usdt' = 'stripe',
  ) => api.post('/recharge/create', { amount, paymentMethod }),
  retryRecharge: (orderNo: string) => api.post(`/recharge/retry/${orderNo}`),
  getHistory: (page?: number, limit?: number) => api.get('/recharge/history', { params: { page, limit } }),
  getOrder: (orderNo: string) => api.get(`/recharge/order/${orderNo}`),
  refreshOrder: (orderNo: string) => api.post(`/recharge/refresh/${orderNo}`),
  confirmRecharge: (orderNo: string, data?: { providerOrderId?: string; transactionReference?: string }) =>
    api.post(`/recharge/pay/${orderNo}`, data || {}),
};

export const channelApi = {
  getAll: () => api.get('/channels'),
  getOne: (id: string) => api.get(`/channels/${id}`),
  getModels: (id: string) => api.get(`/channels/${id}/models`),
};

export const gatewayApi = {
  getLogs: (page?: number, limit?: number) => api.get('/gateway/logs', { params: { page, limit } }),
  getUsageStats: (days?: number) => api.get('/gateway/usage-stats', { params: { days } }),
  getModelCatalog: () => api.get('/gateway/models/catalog'),
};

export const adminApi = {
  getDashboard: () => api.get('/admin/dashboard'),
  getUsers: (page?: number, limit?: number, search?: string) =>
    api.get('/admin/users', { params: { page, limit, search } }),
  getUserDetail: (id: string) => api.get(`/admin/users/${id}`),
  updateUser: (id: string, data: any) => api.put(`/admin/users/${id}`, data),
  getChannels: () => api.get('/admin/channels'),
  getChannelModelPresets: () => api.get('/admin/channel-model-presets'),
  getOpencodeZenPricing: () => api.get('/admin/opencode-zen-pricing'),
  createChannel: (data: any) => api.post('/admin/channels', data),
  updateChannel: (id: string, data: any) => api.put(`/admin/channels/${id}`, data),
  deleteChannel: (id: string) => api.delete(`/admin/channels/${id}`),
  syncChannelOpencodePricing: (id: string) => api.post(`/admin/channels/${id}/sync-opencode-pricing`),
  testChannelModel: (id: string, data: { modelName: string; protocol?: string; message?: string }) =>
    api.post(`/admin/channels/${id}/test-model`, data),
  getLogs: (page?: number, limit?: number, filters?: any) =>
    api.get('/admin/logs', { params: { page, limit, ...filters } }),
  getRecharges: (page?: number, limit?: number, status?: string) =>
    api.get('/admin/recharges', { params: { page, limit, status } }),
  updateRecharge: (id: string, data: { action: 'approve' | 'reject'; note?: string }) =>
    api.put(`/admin/recharges/${id}`, data),
  getAnalytics: (days?: number) => api.get('/admin/analytics', { params: { days } }),
  getWorkspaceTemplates: () => api.get('/admin/workspace/templates'),
  createWorkspaceTemplate: (data: any) => api.post('/admin/workspace/templates', data),
  updateWorkspaceTemplate: (id: string, data: any) => api.put(`/admin/workspace/templates/${id}`, data),
  deleteWorkspaceTemplate: (id: string) => api.delete(`/admin/workspace/templates/${id}`),
};

export const chatApi = {
  createConversation: (title?: string) => api.post('/chat/conversations', { title }),
  getConversations: () => api.get('/chat/conversations'),
  getConversation: (id: string) => api.get(`/chat/conversations/${id}`),
  getMessages: (conversationId: string) => api.get(`/chat/conversations/${conversationId}/messages`),
  deleteConversation: (id: string) => api.delete(`/chat/conversations/${id}`),
  sendMessage: (data: {
    conversationId?: string;
    model?: string;
    skillId?: string;
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
    stream?: boolean;
  }) => api.post('/chat/send', data),
  getModels: () => api.get('/chat/models'),
  getSkills: () => api.get('/chat/skills'),
  getInstalledSkills: () => api.get('/chat/skills/installed'),
  updateInstalledSkills: (skillIds: string[]) => api.put('/chat/skills/installed', { skillIds }),
  getTeams: () => api.get('/chat/teams'),
  getTeam: (id: string) => api.get(`/chat/teams/${id}`),
  createTeam: (data: any) => api.post('/chat/teams', data),
  updateTeam: (id: string, data: any) => api.put(`/chat/teams/${id}`, data),
  deleteTeam: (id: string) => api.delete(`/chat/teams/${id}`),
  runTeamTask: (id: string, task: string) => api.post(`/chat/teams/${id}/run`, { task }),
  getWorkspaceOverview: () => api.get('/chat/workspace/overview'),
  getWorkspaceTemplates: () => api.get('/chat/workspace/templates'),
  getWorkspaceTasks: () => api.get('/chat/workspace/tasks'),
  getWorkspaceTask: (id: string) => api.get(`/chat/workspace/tasks/${id}`),
  createWorkspaceTask: (data: any) => api.post('/chat/workspace/tasks', data),
  updateWorkspaceTask: (id: string, data: any) => api.put(`/chat/workspace/tasks/${id}`, data),
  runWorkspaceTask: (id: string) => api.post(`/chat/workspace/tasks/${id}/run`),
  getWorkspaceApprovals: () => api.get('/chat/workspace/approvals'),
  approveWorkspaceTask: (id: string, reviewerNote?: string) =>
    api.post(`/chat/workspace/approvals/${id}/approve`, { reviewerNote }),
  rejectWorkspaceTask: (id: string, reviewerNote?: string) =>
    api.post(`/chat/workspace/approvals/${id}/reject`, { reviewerNote }),
  getWorkspaceDeliverables: () => api.get('/chat/workspace/deliverables'),
  queueWorkspaceDeliverableLocalActions: (id: string, bridgeId: string) =>
    api.post(`/chat/workspace/deliverables/${id}/queue-local`, { bridgeId }),
  exportWorkspaceDeliverable: (id: string) => api.get(`/chat/workspace/deliverables/${id}/export`),
  getLocalBridges: () => api.get('/chat/local-bridge/bridges'),
  createLocalBridge: (data: any) => api.post('/chat/local-bridge/bridges', data),
  getLocalBridgeJobs: (bridgeId?: string) => api.get('/chat/local-bridge/jobs', { params: { bridgeId } }),
  enqueueLocalBridgeJob: (bridgeId: string, data: any) => api.post(`/chat/local-bridge/bridges/${bridgeId}/jobs`, data),
  getStats: () => api.get('/chat/stats'),
};

export default api;
