import * as React from 'react';

import { TurnstileWidget } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfig } from '@/hooks/use-config';
import { getSecurityHeaders } from '@/lib/api';
import { getToken, setToken, setUser } from '@/lib/auth';

function getSsoCallback(): URL | null {
	const returnTo = new URLSearchParams(window.location.search).get('return_to');
	if (!returnTo) return null;

	try {
		const callback = new URL(returnTo);
		const allowedOrigin = callback.protocol === 'https:' &&
			(callback.hostname === 'www.rayoims.com' || callback.hostname === 'rayoims.com');

		if (
			!allowedOrigin ||
			callback.pathname !== '/auth/callback' ||
			callback.hash ||
			!callback.searchParams.get('state')?.match(/^[A-Za-z0-9_-]{32,128}$/)
		) return null;

		return callback;
	} catch {
		return null;
	}
}

export function LoginPage() {
	const { config } = useConfig();
	const [email, setEmail] = React.useState('');
	const [password, setPassword] = React.useState('');
	const [totpCode, setTotpCode] = React.useState('');
	const [turnstileToken, setTurnstileToken] = React.useState('');
	const [turnstileResetKey, setTurnstileResetKey] = React.useState(0);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState('');
	const ssoStarted = React.useRef(false);
	const ssoCallback = React.useMemo(() => getSsoCallback(), []);

	const enabled = !!config?.turnstile_enabled;
	const siteKey = config?.turnstile_site_key || '';
	const turnstileActive = enabled && !!siteKey;

	async function completeSso(token: string): Promise<boolean> {
		if (!ssoCallback) return false;

		const redirectUri = `${ssoCallback.origin}${ssoCallback.pathname}`;
		const response = await fetch('/api/sso/authorize', {
			method: 'POST',
			headers: {
				...getSecurityHeaders('POST'),
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				redirect_uri: redirectUri,
				state: ssoCallback.searchParams.get('state'),
			}),
		});

		const data = await response.json() as {
			code?: string;
			state?: string;
			redirect_uri?: string;
			error?: string;
		};

		if (
			!response.ok ||
			!data.code ||
			data.redirect_uri !== redirectUri ||
			data.state !== ssoCallback.searchParams.get('state')
		) {
			throw new Error(data.error || '统一登录失败，请重试');
		}

		const destination = new URL(redirectUri);
		destination.searchParams.set('code', data.code);
		destination.searchParams.set('state', data.state);
		window.location.assign(destination.toString());
		return true;
	}

	React.useEffect(() => {
		const token = getToken();
		if (!ssoCallback || !token || ssoStarted.current) return;

		ssoStarted.current = true;
		setLoading(true);
		completeSso(token)
			.catch((err: any) => setError(String(err?.message || err)))
			.finally(() => setLoading(false));
	}, []);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError('');

		if (turnstileActive && !turnstileToken) {
			setError('请完成验证码验证');
			return;
		}

		setLoading(true);
		try {
			const res = await fetch('/api/login', {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({
					email,
					password,
					totp_code: totpCode,
					'cf-turnstile-response': turnstileToken,
				}),
			});

			const data = (await res.json()) as any;
			if (!res.ok) {
				setTurnstileToken('');
				setTurnstileResetKey((v) => v + 1);
				if (data?.error === 'TOTP_REQUIRED') {
					setError('请输入 2FA 验证码');
					return;
				}
				throw new Error(data?.error || '登录失败');
			}

			setUser(data.user);
			setToken(data.token);
			if (await completeSso(data.token)) return;
			window.location.href = '/';
		} catch (err: any) {
			setError(String(err?.message || err));
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="min-h-dvh bg-muted/20">
			<main className="mx-auto flex max-w-5xl justify-center px-4 py-10">
				<Card className="w-full max-w-md">
					<CardHeader>
						<CardTitle>登录</CardTitle>
					</CardHeader>
					<CardContent>
						<form className="space-y-4" onSubmit={handleSubmit}>
							{error ? (
								<div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
									{error}
								</div>
							) : null}

							<div className="space-y-2">
								<Label htmlFor="login-email">邮箱</Label>
								<Input
									id="login-email"
									name="email"
									type="email"
									autoComplete="username"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="login-password">密码</Label>
								<Input
									id="login-password"
									name="password"
									type="password"
									autoComplete="current-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="login-totp">双重验证码 (若开启)</Label>
								<Input
									id="login-totp"
									name="totp_code"
									type="text"
									inputMode="numeric"
									pattern="\d*"
									maxLength={6}
									placeholder="选填"
									autoComplete="one-time-code"
									value={totpCode}
									onChange={(e) => setTotpCode(e.target.value)}
								/>
							</div>

							<TurnstileWidget
								enabled={turnstileActive}
								siteKey={siteKey}
								onToken={setTurnstileToken}
								resetKey={turnstileResetKey}
							/>

							<Button className="w-full" type="submit" disabled={loading}>
								{loading ? '处理中...' : '登录'}
							</Button>

							<div className="flex justify-between text-sm">
								<a className="text-muted-foreground hover:underline" href="/register">
									没有账号？注册
								</a>
								<a className="text-muted-foreground hover:underline" href="/forgot">
									忘记密码？
								</a>
							</div>
						</form>
					</CardContent>
				</Card>
			</main>
		</div>
	);
}
