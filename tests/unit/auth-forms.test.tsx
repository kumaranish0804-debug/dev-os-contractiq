import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resend: vi.fn(),
  signOut: vi.fn(),
};
const router = { replace: vi.fn(), refresh: vi.fn() };

vi.mock('@/lib/env', () => ({ publicEnv: { NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' } }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { LoginForm } from '@/components/auth/LoginForm';
import { SignUpCard } from '@/components/auth/SignUpCard';
import { UserMenu } from '@/components/auth/UserMenu';
import { useCountdown } from '@/hooks/use-countdown';

const fill = async (user: ReturnType<typeof userEvent.setup>, label: string, value: string) =>
  user.type(screen.getByLabelText(label, { selector: 'input' }), value);

beforeEach(() => {
  Object.values(auth).forEach((fn) => fn.mockReset());
  Object.values(router).forEach((fn) => fn.mockReset());
});

describe('LoginForm', () => {
  it('validates before calling Supabase and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    render(<LoginForm next="/dashboard" />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in with a normalised email and goes to next', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LoginForm next="/contracts/123" />);
    await fill(user, 'Email', ' Jane@Example.com ');
    await fill(user, 'Password', 'secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/contracts/123'));
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'jane@example.com',
      password: 'secret123',
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('on wrong credentials keeps the email, clears the password and focuses it', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { code: 'invalid_credentials' } });
    const user = userEvent.setup();
    render(<LoginForm next="/dashboard" />);
    await fill(user, 'Email', 'jane@example.com');
    await fill(user, 'Password', 'wrong-pass1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.getByLabelText('Email')).toHaveValue('jane@example.com');
    expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveValue('');
    expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveFocus();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('offers to resend the verification email when unconfirmed', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { code: 'email_not_confirmed' } });
    auth.resend.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LoginForm next="/dashboard" />);
    await fill(user, 'Email', 'jane@example.com');
    await fill(user, 'Password', 'secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await user.click(await screen.findByRole('button', { name: 'Resend verification email' }));
    expect(auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'jane@example.com',
      options: { emailRedirectTo: 'http://localhost:3000/auth/callback' },
    });
    expect(await screen.findByText('Verification email sent.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resend verification email \(60s\)/ })).toBeDisabled();
  });

  it('shows a generic error when the network fails', async () => {
    auth.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<LoginForm next="/dashboard" />);
    await fill(user, 'Email', 'jane@example.com');
    await fill(user, 'Password', 'secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('toggles password visibility with an aria-pressed button', async () => {
    const user = userEvent.setup();
    render(<LoginForm next="/dashboard" />);
    const toggle = screen.getByRole('button', { name: 'Show password' });
    const input = screen.getByLabelText('Password', { selector: 'input' });

    expect(input).toHaveAttribute('type', 'password');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(input).toHaveAttribute('type', 'text');
  });
});

describe('SignUpCard', () => {
  async function submit(user: ReturnType<typeof userEvent.setup>, optIn = false) {
    await fill(user, 'Email', 'Jane@Example.com');
    await fill(user, 'Password', 'contract9');
    await fill(user, 'Confirm password', 'contract9');
    if (optIn) await user.click(screen.getByLabelText(/sharing anonymised corrections/));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
  }

  it('signs up and shows the check-your-inbox state', async () => {
    auth.signUp.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignUpCard />);
    await submit(user, true);

    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'jane@example.com',
      password: 'contract9',
      options: {
        emailRedirectTo: 'http://localhost:3000/auth/callback',
        data: { feedback_opt_in: 'true' },
      },
    });
  });

  it('sends feedback_opt_in false when the box is left unchecked', async () => {
    auth.signUp.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignUpCard />);
    await submit(user);
    await screen.findByRole('heading', { name: 'Check your inbox' });
    expect(auth.signUp.mock.calls[0]![0].options.data).toEqual({ feedback_opt_in: 'false' });
  });

  it('shows an inline error with a sign-in link for an existing account', async () => {
    auth.signUp.mockResolvedValue({ error: { code: 'user_already_exists' } });
    const user = userEvent.setup();
    render(<SignUpCard />);
    await submit(user);

    expect(
      await screen.findByText('An account with this email already exists.', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in instead' })).toHaveAttribute('href', '/login');
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('flags mismatched passwords without calling Supabase', async () => {
    const user = userEvent.setup();
    render(<SignUpCard />);
    await fill(user, 'Email', 'jane@example.com');
    await fill(user, 'Password', 'contract9');
    await fill(user, 'Confirm password', 'contract8');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('offers Retry on unexpected errors', async () => {
    auth.signUp
      .mockResolvedValueOnce({ error: { code: 'unexpected_failure' } })
      .mockResolvedValueOnce({ error: null });
    const user = userEvent.setup();
    render(<SignUpCard />);
    await submit(user);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(auth.signUp).toHaveBeenCalledTimes(2);
  });

  it('locks Resend email for 60 seconds after sending', async () => {
    auth.signUp.mockResolvedValue({ error: null });
    auth.resend.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignUpCard />);
    await submit(user);

    await user.click(await screen.findByRole('button', { name: 'Resend email' }));
    expect(await screen.findByRole('button', { name: 'Resend email (60s)' })).toBeDisabled();
  });
});

describe('useCountdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts down once per second and stops at zero', () => {
    const { result } = renderHook(() => useCountdown());
    act(() => result.current.start(3));
    expect(result.current.remaining).toBe(3);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.remaining).toBe(2);
    act(() => vi.advanceTimersByTime(1000));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.remaining).toBe(0);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.remaining).toBe(0);
  });
});

describe('UserMenu', () => {
  it('signs out, clears the query cache and returns home', async () => {
    auth.signOut.mockResolvedValue({ error: null });
    const queryClient = new QueryClient();
    queryClient.setQueryData(['contracts'], [{ id: 1 }]);
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <UserMenu email="jane@example.com" />
      </QueryClientProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'Account menu' });
    expect(trigger).toHaveTextContent('J');
    trigger.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByText('jane@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(auth.signOut).toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalled();
    expect(queryClient.getQueryData(['contracts'])).toBeUndefined();
  });
});
