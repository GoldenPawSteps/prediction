/**
 * Market Detail Page - Comments Section
 * Demonstrates independent section loading
 * Loads after header and probability as a separate, non-blocking component
 */

'use client'

import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useI18n, useT } from '@/context/I18nContext'
import { usePageSection } from '@/lib/client-page-section'
import { CommentsSectionSkeleton } from '@/components/SectionSkeletons'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { Button } from '@/components/ui/Button'
import { formatRelativeTime } from '@/lib/utils'
import toast from 'react-hot-toast'

interface Comment {
  id: string
  content: string
  createdAt: string
  user: {
    id: string
    username: string
    avatar: string | null
  }
}

export function MarketCommentsSection({
  marketId,
  isPrefetched,
  onCommentPosted,
}: {
  marketId: string
  isPrefetched?: boolean
  onCommentPosted?: () => void
}) {
  const { user } = useAuth()
  const { locale } = useI18n()
  const t = useT('marketDetail')
  const tCommon = useT('common')

  const [comment, setComment] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)

  // Load comments with background refresh every 8 seconds
  const { data: comments, isLoading, refetch } = usePageSection<Comment[]>({
    key: `market-comments:${marketId}`,
    url: `/api/markets/${marketId}/comments`,
    revalidateInterval: 8000, // Refresh comments every 8 seconds
    shouldConsume: isPrefetched,
    debug: false,
  })

  const handleComment = async () => {
    if (!comment.trim()) return

    setSubmittingComment(true)
    try {
      const res = await fetch(`/api/markets/${marketId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: comment }),
      })

      if (res.ok) {
        setComment('')
        await refetch() // Manually refetch to show new comment immediately
        onCommentPosted?.()
        toast.success(t('commentPosted'))
      } else {
        const data = await res.json()
        toast.error(data.error || t('commentPostFailed'))
      }
    } catch (err) {
      toast.error(t('networkError'))
    } finally {
      setSubmittingComment(false)
    }
  }

  if (isLoading) return <CommentsSectionSkeleton />

  const commentList = comments || []

  return (
    <SectionErrorBoundary sectionName="market-comments">
      <div className="bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t('discussion')} ({commentList.length})
          </h2>
        </div>

        {user && (
          <div className="flex gap-2 mb-4">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submittingComment) handleComment()
              }}
              placeholder={t('shareThoughts')}
              className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <Button size="sm" onClick={handleComment} loading={submittingComment}>
              {t('post')}
            </Button>
          </div>
        )}

        {commentList.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-500 text-sm text-center py-4">{t('noCommentsYet')}</p>
        ) : (
          <div className="space-y-3">
            {commentList.map((c) => (
              <div key={c.id} className="flex gap-3">
                <div className="w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                  {c.user.username[0].toUpperCase()}
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">@{c.user.username}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-500">{formatRelativeTime(c.createdAt, locale)}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{c.content}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionErrorBoundary>
  )
}
