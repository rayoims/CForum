import * as React from 'react';
import { CalendarDays, Eye, Heart, MessageCircle, UserRound } from 'lucide-react';

import { PageShell } from '@/components/page-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch, formatDate } from '@/lib/api';

type Profile = {
    id: number;
    username: string;
    nickname: string;
    avatar_url: string | null;
    role: string;
    created_at: string;
};

type ProfilePost = {
    id: number;
    title: string;
    created_at: string;
    view_count: number;
    category_name: string | null;
    like_count: number;
    comment_count: number;
};

export function ProfilePage() {
    const userId = new URLSearchParams(window.location.search).get('id');
    const [profile, setProfile] = React.useState<Profile | null>(null);
    const [posts, setPosts] = React.useState<ProfilePost[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');

    React.useEffect(() => {
        if (!userId || !/^\d+$/.test(userId)) {
            setError('用户不存在');
            setLoading(false);
            return;
        }

        apiFetch<{ user: Profile; posts: ProfilePost[] }>(`/users/${userId}`)
            .then((data) => {
                setProfile(data.user);
                setPosts(data.posts);
            })
            .catch((err: any) => setError(String(err?.message || '加载个人主页失败')))
            .finally(() => setLoading(false));
    }, [userId]);

    return (
        <PageShell>
            <div className="mx-auto max-w-3xl space-y-6">
                {loading ? (
                    <Card>
                        <CardContent className="py-10 text-center text-muted-foreground">
                            正在加载个人主页…
                        </CardContent>
                    </Card>
                ) : null}

                {!loading && error ? (
                    <Card>
                        <CardContent className="py-10 text-center text-destructive">
                            {error}
                        </CardContent>
                    </Card>
                ) : null}

                {!loading && profile ? (
                    <>
                        <Card>
                            <CardContent className="flex flex-col items-center gap-4 py-8 text-center sm:flex-row sm:text-left">
                                {profile.avatar_url ? (
                                    <img
                                        src={profile.avatar_url}
                                        alt=""
                                        className="h-24 w-24 rounded-full object-cover"
                                        referrerPolicy="no-referrer"
                                    />
                                ) : (
                                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-muted text-3xl text-muted-foreground">
                                        <UserRound className="h-10 w-10" />
                                    </div>
                                )}

                                <div className="min-w-0">
                                    <h1 className="text-2xl font-bold">
                                        {profile.nickname || profile.username}
                                    </h1>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        @{profile.username}
                                        {profile.role === 'admin' ? ' · 管理员' : ''}
                                    </p>
                                    <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
                                        <CalendarDays className="h-4 w-4" />
                                        注册于 {formatDate(profile.created_at)}
                                    </p>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>发布的帖子</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {posts.length ? posts.map((post) => (
                                    <a
                                        key={post.id}
                                        href={`/post?id=${post.id}`}
                                        className="block rounded-lg border p-4 transition-colors hover:bg-muted/40"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <h2 className="font-semibold">{post.title}</h2>
                                            <span className="text-xs text-muted-foreground">
                                                {formatDate(post.created_at)}
                                            </span>
                                        </div>
                                        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                                            {post.category_name ? <span>{post.category_name}</span> : null}
                                            <span className="inline-flex items-center gap-1">
                                                <Eye className="h-3.5 w-3.5" />
                                                {post.view_count || 0}
                                            </span>
                                            <span className="inline-flex items-center gap-1">
                                                <Heart className="h-3.5 w-3.5" />
                                                {post.like_count || 0}
                                            </span>
                                            <span className="inline-flex items-center gap-1">
                                                <MessageCircle className="h-3.5 w-3.5" />
                                                {post.comment_count || 0}
                                            </span>
                                        </div>
                                    </a>
                                )) : (
                                    <p className="py-4 text-sm text-muted-foreground">
                                        还没有发布帖子。
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    </>
                ) : null}
            </div>
        </PageShell>
    );
}
