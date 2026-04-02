"""
Janela de login do agente — Compatibilidade e uso standalone.

A tela de login principal agora é integrada ao ScreenLockOverlay (screen_lock.py).
Este módulo existe para uso standalone (modo --login) quando necessário.
"""

import threading
import logging

import customtkinter as ctk

from api_client import APIClient

logger = logging.getLogger('agent.login')

# Tema global
ctk.set_appearance_mode('dark')

# Paleta de cores (mesma do overlay / frontend web)
COLORS = {
    'bg': '#08080f',
    'card': '#111119',
    'card_border': '#1a1a2e',
    'accent': '#7c6cf0',
    'accent_hover': '#8e80ff',
    'text': '#f0f0f5',
    'text_secondary': '#9595b0',
    'text_muted': '#555570',
    'success': '#34d399',
    'warning': '#fbbf24',
    'danger': '#f87171',
    'input_bg': '#0d0d18',
    'input_border': '#2a2a40',
}


class LoginWindow(ctk.CTk):
    """Janela de login standalone (tema dark purple, design do web frontend)."""

    WIDTH = 420
    HEIGHT = 520

    def __init__(self, api_client: APIClient, on_login_success=None):
        super().__init__()

        self.api_client = api_client
        self.on_login_success = on_login_success

        # ── Configuração da janela ──
        self.title('Sistema de Laboratórios')
        self.geometry(f'{self.WIDTH}x{self.HEIGHT}')
        self.resizable(False, False)
        self.configure(fg_color=COLORS['bg'])

        # Centraliza na tela
        self.update_idletasks()
        x = (self.winfo_screenwidth() - self.WIDTH) // 2
        y = (self.winfo_screenheight() - self.HEIGHT) // 2
        self.geometry(f'{self.WIDTH}x{self.HEIGHT}+{x}+{y}')

        self._build_ui()

    # ── UI ────────────────────────────────────────────────────────
    def _build_ui(self):
        # Card principal
        card = ctk.CTkFrame(
            self,
            corner_radius=16,
            fg_color=COLORS['card'],
            border_color=COLORS['card_border'],
            border_width=1,
        )
        card.pack(fill='both', expand=True, padx=16, pady=16)

        # Ícone diamante
        ctk.CTkLabel(
            card,
            text='◆',
            font=ctk.CTkFont(size=36),
            text_color=COLORS['accent'],
        ).pack(pady=(32, 4))

        # Título
        ctk.CTkLabel(
            card,
            text='Laboratórios',
            font=ctk.CTkFont(family='Inter', size=20, weight='bold'),
            text_color=COLORS['text'],
        ).pack(pady=(0, 4))

        ctk.CTkLabel(
            card,
            text='Faça login para continuar',
            font=ctk.CTkFont(family='Inter', size=13),
            text_color=COLORS['text_secondary'],
        ).pack(pady=(0, 28))

        # Formulário
        form = ctk.CTkFrame(card, fg_color='transparent')
        form.pack(padx=40, fill='x')

        ctk.CTkLabel(
            form, text='Email',
            font=ctk.CTkFont(family='Inter', size=12),
            text_color=COLORS['text_secondary'], anchor='w',
        ).pack(fill='x', pady=(0, 4))

        self.email_entry = ctk.CTkEntry(
            form,
            placeholder_text='seu.email@exemplo.com',
            height=42,
            font=ctk.CTkFont(family='Inter', size=14),
            fg_color=COLORS['input_bg'],
            border_color=COLORS['input_border'],
            border_width=1,
            corner_radius=10,
            text_color=COLORS['text'],
        )
        self.email_entry.pack(fill='x', pady=(0, 12))

        ctk.CTkLabel(
            form, text='Senha',
            font=ctk.CTkFont(family='Inter', size=12),
            text_color=COLORS['text_secondary'], anchor='w',
        ).pack(fill='x', pady=(0, 4))

        self.password_entry = ctk.CTkEntry(
            form,
            placeholder_text='••••••••',
            show='•',
            height=42,
            font=ctk.CTkFont(family='Inter', size=14),
            fg_color=COLORS['input_bg'],
            border_color=COLORS['input_border'],
            border_width=1,
            corner_radius=10,
            text_color=COLORS['text'],
        )
        self.password_entry.pack(fill='x', pady=(0, 24))

        # Botão ENTRAR
        self.login_btn = ctk.CTkButton(
            form,
            text='ENTRAR',
            height=44,
            font=ctk.CTkFont(family='Inter', size=15, weight='bold'),
            fg_color=COLORS['accent'],
            hover_color=COLORS['accent_hover'],
            corner_radius=10,
            command=self._on_login_click,
        )
        self.login_btn.pack(fill='x')

        # Status
        self.status_label = ctk.CTkLabel(
            card,
            text='',
            font=ctk.CTkFont(family='Inter', size=13),
            text_color=COLORS['text_secondary'],
            wraplength=300,
        )
        self.status_label.pack(pady=(16, 0))

        # Atalhos
        self.bind('<Return>', lambda _: self._on_login_click())
        self.email_entry.focus()

    # ── Ações ─────────────────────────────────────────────────────
    def _on_login_click(self):
        email = self.email_entry.get().strip()
        password = self.password_entry.get().strip()

        if not email or not password:
            self._set_status('Preencha todos os campos.', COLORS['warning'])
            return

        self.login_btn.configure(state='disabled', text='Validando...')
        self._set_status('Conectando ao servidor...', COLORS['text_secondary'])

        t = threading.Thread(target=self._validate, args=(email, password), daemon=True)
        t.start()

    def _validate(self, email: str, password: str):
        result = self.api_client.validate_user(email, password)
        self.after(0, self._handle_result, result)

    def _handle_result(self, result):
        self.login_btn.configure(state='normal', text='ENTRAR')

        if result is None:
            self._set_status('Erro de conexão com o servidor.', COLORS['danger'])
            return

        if result.get('allowed'):
            user = result.get('user', {})
            name = user.get('fullName', 'Usuário')
            self._set_status(f'✓ Bem-vindo(a), {name}!', COLORS['success'])

            self.api_client.report_login(name)
            logger.info(f'Login autorizado: {name}')

            if self.on_login_success:
                self.on_login_success(result)

            self.after(2000, self.destroy)
        else:
            reason = result.get('reason', 'UNKNOWN')
            messages = {
                'INVALID_CREDENTIALS': 'Email ou senha inválidos.',
                'NO_ACTIVE_ALLOCATION': 'Sem alocação ativa para esta máquina.',
                'MACHINE_MAINTENANCE': 'Máquina em manutenção.',
            }
            msg = messages.get(reason, result.get('message', 'Acesso negado.'))
            self._set_status(f'✗ {msg}', COLORS['danger'])

    def _set_status(self, text: str, color: str):
        self.status_label.configure(text=text, text_color=color)


# ── API pública ──────────────────────────────────────────────────

def show_login(api_client: APIClient, on_success=None):
    """Abre a janela de login standalone (bloqueante — roda mainloop)."""
    app = LoginWindow(api_client, on_login_success=on_success)
    app.mainloop()
