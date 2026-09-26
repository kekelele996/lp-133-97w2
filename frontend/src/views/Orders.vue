<template>
  <div class="min-h-screen bg-gray-50">
    <div class="container mx-auto px-4 py-6">
      <h1 class="text-2xl font-bold text-gray-800 mb-6">我的订单</h1>

      <el-card class="mb-6">
        <el-tabs v-model="activeTab" @tab-change="fetchOrders">
          <el-tab-pane label="进行中" name="in_progress" />
          <el-tab-pane label="待确认" name="pending_confirm" />
          <el-tab-pane label="已完成" name="completed" />
          <el-tab-pane label="全部" name="" />
        </el-tabs>
      </el-card>

      <div v-if="loading" class="text-center py-16">
        <el-icon class="animate-spin text-4xl text-gray-400"><Loading /></el-icon>
      </div>

      <div v-else-if="orders.length === 0" class="text-center py-16">
        <el-icon class="text-6xl text-gray-300"><Document /></el-icon>
        <p class="mt-4 text-gray-500">暂无订单</p>
      </div>

      <div v-else class="space-y-4">
        <el-card v-for="order in orders" :key="order.id" class="hover:shadow-md">
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center mb-2">
                <h3 class="font-medium text-lg mr-3">{{ order.title }}</h3>
                <el-tag :type="getTypeColor(order.type)" size="small">
                  {{ getTypeName(order.type) }}
                </el-tag>
                <el-tag v-if="order.status === 'in_progress'" type="warning" class="ml-2" size="small">进行中</el-tag>
                <el-tag v-else-if="order.status === 'pending_confirm'" type="primary" class="ml-2" size="small">待确认</el-tag>
                <el-tag v-else-if="order.status === 'completed'" type="success" class="ml-2" size="small">已完成</el-tag>
              </div>

              <div class="text-gray-600 text-sm mb-3">
                <p v-if="user?.role === 'volunteer'">
                  <el-icon class="mr-1"><User /></el-icon>
                  服务对象：{{ order.user_name }}
                </p>
                <p v-else>
                  <el-icon class="mr-1"><Service /></el-icon>
                  志愿者：{{ order.volunteer_name }}
                </p>
                <p class="mt-1">
                  <el-icon class="mr-1"><Location /></el-icon>
                  {{ order.address }}
                </p>
                <p v-if="Number(order.service_hours) > 0" class="mt-1">
                  <el-icon class="mr-1"><Clock /></el-icon>
                  服务时长：{{ order.service_hours }} 小时
                  <span v-if="order.status === 'pending_confirm'" class="text-gray-400">
                    （确认后将结算 {{ Number(order.service_hours) * 10 }} 积分）
                  </span>
                  <span v-else-if="order.status === 'completed'" class="text-green-600">
                    （已结算 {{ Number(order.service_hours) * 10 }} 积分）
                  </span>
                </p>
                <!-- 当前所处步骤，让双方一眼看清进度 -->
                <p class="mt-2">
                  <el-steps :active="stepActive(order)" align-center finish-status="success" simple>
                    <el-step title="进行中" />
                    <el-step title="待确认" />
                    <el-step title="已完成" />
                  </el-steps>
                </p>
                <p class="mt-2 text-xs text-gray-500">
                  <span v-if="order.status === 'in_progress' && user?.role === 'volunteer'">
                    服务完成后请提交服务时长，提交后等待居民确认
                  </span>
                  <span v-else-if="order.status === 'in_progress' && user?.role === 'resident'">
                    志愿者正在服务中，完成后会提交服务时长请您确认
                  </span>
                  <span v-else-if="order.status === 'pending_confirm' && user?.role === 'volunteer'">
                    已提交 {{ order.service_hours }} 小时服务时长，等待居民确认；如被退回可重新提交
                  </span>
                  <span v-else-if="order.status === 'pending_confirm' && user?.role === 'resident'">
                    志愿者提交了 {{ order.service_hours }} 小时服务时长，请确认或退回
                  </span>
                  <span v-else-if="order.status === 'completed'">
                    居民已确认，服务时长与积分已结算完成
                  </span>
                </p>
              </div>

              <div class="text-xs text-gray-400">
                下单时间：{{ new Date(order.created_at).toLocaleString() }}
              </div>
            </div>

            <div class="flex flex-col gap-2 ml-4 shrink-0">
              <!-- 进行中：只有志愿者可以提交服务时长 -->
              <el-button
                v-if="order.status === 'in_progress' && user?.role === 'volunteer'"
                type="primary"
                size="small"
                @click="openSubmitDialog(order)"
              >
                提交服务时长
              </el-button>
              <!-- 待确认且是居民：确认完成 / 退回 -->
              <template v-if="order.status === 'pending_confirm' && user?.role === 'resident'">
                <el-button type="success" size="small" :loading="actingId === order.id" @click="handleConfirm(order)">
                  确认完成
                </el-button>
                <el-button type="warning" plain size="small" :loading="actingId === order.id" @click="handleReject(order)">
                  退回
                </el-button>
              </template>
              <!-- 待确认且是志愿者：等待提示，无操作按钮 -->
              <el-tag
                v-if="order.status === 'pending_confirm' && user?.role === 'volunteer'"
                type="info"
                size="small"
              >
                等待居民确认
              </el-tag>
              <el-button
                v-if="order.status === 'completed' && !hasReviewed(order.id)"
                type="success"
                size="small"
                @click="showReviewDialog(order)"
              >
                去评价
              </el-button>
              <el-button
                type="text"
                size="small"
                @click="handleMessage(order)"
              >
                <el-icon class="mr-1"><ChatDotRound /></el-icon>
                发消息
              </el-button>
            </div>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 志愿者提交服务时长 -->
    <el-dialog v-model="submitDialogVisible" title="提交服务时长" width="420px">
      <el-form label-width="100px">
        <el-form-item label="服务时长">
          <el-input-number v-model="submitForm.service_hours" :min="1" :max="12" :step="1" :precision="0" />
          <span class="ml-2 text-gray-500 text-sm">小时（1-12）</span>
        </el-form-item>
        <div class="text-sm text-gray-500 pl-2">
          提交后订单进入「待确认」，居民确认后按每小时 10 积分结算
          （本次预计 {{ submitForm.service_hours * 10 }} 积分）。
        </div>
      </el-form>
      <template #footer>
        <el-button @click="submitDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitHours">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="reviewDialogVisible" title="服务评价" width="500px">
      <el-form :model="reviewForm" label-width="80px">
        <el-form-item label="评分">
          <el-rate v-model="reviewForm.rating" :max="5" show-score />
        </el-form-item>
        <el-form-item label="评价内容">
          <el-input v-model="reviewForm.comment" type="textarea" :rows="3" placeholder="请输入评价内容" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submittingReview" @click="submitReview">提交评价</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import api from '@/utils/api'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()
const userStore = useUserStore()
const user = computed(() => userStore.user)

const orders = ref([])
const loading = ref(false)
const activeTab = ref('in_progress')
const reviewDialogVisible = ref(false)
const submittingReview = ref(false)
const currentOrder = ref(null)
const reviewedOrders = ref([])

const submitDialogVisible = ref(false)
const submitting = ref(false)
const submitForm = ref({ service_hours: 1 })
const actingId = ref(null)

const reviewForm = ref({
  rating: 5,
  comment: ''
})

const typeMap = {
  accompany: { name: '陪聊陪诊', color: 'blue' },
  shopping: { name: '代买代办', color: 'green' },
  repair: { name: '家电维修', color: 'orange' },
  housework: { name: '家政服务', color: 'purple' },
  other: { name: '其他帮助', color: 'gray' }
}

const getTypeName = (type) => typeMap[type]?.name || type
const getTypeColor = (type) => typeMap[type]?.color || 'info'

const hasReviewed = (orderId) => reviewedOrders.value.includes(orderId)

const stepActive = (order) => {
  if (order.status === 'in_progress') return 0
  if (order.status === 'pending_confirm') return 1
  return 2
}

const fetchOrders = async () => {
  loading.value = true
  try {
    const params = activeTab.value ? { status: activeTab.value } : {}
    const res = await api.get('/orders', { params })
    orders.value = res.data.orders
  } finally {
    loading.value = false
  }
}

const openSubmitDialog = (order) => {
  currentOrder.value = order
  submitForm.value = { service_hours: 1 }
  submitDialogVisible.value = true
}

const submitHours = async () => {
  try {
    submitting.value = true
    await api.put(`/orders/${currentOrder.value.id}/submit`, {
      service_hours: submitForm.value.service_hours
    })
    ElMessage.success('已提交，等待居民确认')
    submitDialogVisible.value = false
    fetchOrders()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

const handleConfirm = async (order) => {
  try {
    await ElMessageBox.confirm(
      `确认本次服务时长为 ${order.service_hours} 小时吗？确认后将按每小时 10 积分结算给志愿者。`,
      '确认服务完成',
      {
        confirmButtonText: '确认完成',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    actingId.value = order.id
    const res = await api.put(`/orders/${order.id}/confirm`)
    ElMessage.success(res.data?.message || '服务已完成')
    fetchOrders()
    userStore.fetchUserInfo()
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.response?.data?.message || '操作失败')
    }
  } finally {
    actingId.value = null
  }
}

const handleReject = async (order) => {
  try {
    await ElMessageBox.confirm(
      '退回后订单将重新进入进行中，志愿者可修改服务时长后重新提交。',
      '退回服务时长',
      {
        confirmButtonText: '确认退回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    actingId.value = order.id
    await api.put(`/orders/${order.id}/reject`)
    ElMessage.success('已退回，订单重新进入进行中')
    fetchOrders()
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.response?.data?.message || '操作失败')
    }
  } finally {
    actingId.value = null
  }
}

const showReviewDialog = (order) => {
  currentOrder.value = order
  reviewForm.value = { rating: 5, comment: '' }
  reviewDialogVisible.value = true
}

const submitReview = async () => {
  try {
    submittingReview.value = true
    await api.post(`/orders/${currentOrder.value.id}/review`, reviewForm.value)
    reviewedOrders.value.push(currentOrder.value.id)
    ElMessage.success('评价成功')
    reviewDialogVisible.value = false
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '评价失败')
  } finally {
    submittingReview.value = false
  }
}

const handleMessage = (order) => {
  const otherUserId = user.value.role === 'volunteer' ? order.user_id : order.volunteer_id
  router.push({
    path: '/messages',
    query: { userId: otherUserId }
  })
}

onMounted(() => {
  fetchOrders()
})
</script>
