"""
Janela de login do agente — Interface gráfica para validação de usuário.

Utiliza customtkinter para uma aparência moderna com tema escuro.
Sem opção de registro; apenas login funcional.
"""

import threading
import logging

import customtkinter as ctk

from api_client import APIClient

logger = logging.getLogger('agent.login')

# Tema global
ctk.set_appearance_mode('dark')
ctk.set_default_color_theme('blue')


class LoginWindow(ctk.CTk):
    """Janela de login dark-themed para validação de usuário na máquina."""

    WIDTH = 420
    HEIGHT = 480

    def __init__(self, api_client: APIClient, on_login_success=None):
        super().__init__()

        self.api_client = api_client
        self.on_login_success = on_login_success

        # ---- Configuração da janela ----
        self.title('Sistema de Laboratórios')
        self.geometry(f'{self.WIDTH}x{self.HEIGHT}')
        self.resizable(False, False)

        # Centraliza na tela
        self.update_idletasks()
        x = (self.winfo_screenwidth() - self.WIDTH) // 2
        y = (self.winfo_screenheight() - self.HEIGHT) // 2
        self.geometry(f'{self.WIDTH}x{self.HEIGHT}+{x}+{y}')

        self._build_ui()

    # ------------------------------------------------------------------ UI
    def _build_ui(self):
        # Container principal
        frame = ctk.CTkFrame(self, corner_radius=0)
        frame.pack(fill='both', expand=True)

        # Título da aplicação
        ctk.CTkLabel(
            frame,
            text='SISTEMA DE LABORATÓRIOS',
            font=ctk.CTkFont(size=17, weight='bold'),
        ).pack(pady=(40, 8))

        # Ícone + subtítulo
        ctk.CTkLabel(
            frame,
            text='🔒  LOGIN',
            font=ctk.CTkFont(size=22, weight='bold'),
        ).pack(pady=(4, 32))

        # Campo e-mail
        self.email_entry = ctk.CTkEntry(
            frame,
            placeholder_text='Email',
            width=300,
            height=44,
            font=ctk.CTkFont(size=14),
        )
        self.email_entry.pack(pady=(0, 14))

        # Campo senha
        self.password_entry = ctk.CTkEntry(
            frame,
            placeholder_text='Senha',
            show='•',
            width=300,
            height=44,
            font=ctk.CTkFont(size=14),
        )
        self.password_entry.pack(pady=(0, 28))

        # Botão ENTRAR
        self.login_btn = ctk.CTkButton(
            frame,
            text='ENTRAR',
            width=300,
            height=44,
            font=ctk.CTkFont(size=15, weight='bold'),
            command=self._on_login_click,
        )
        self.login_btn.pack(pady=(0, 16))

        # Label de status (feedback ao usuário)
        self.status_label = ctk.CTkLabel(
            frame,
            text='',
            font=ctk.CTkFont(size=13),
            text_color='gray',
            wraplength=300,
        )
        self.status_label.pack(pady=(8, 0))

        # Atalhos de teclado
        self.bind('<Return>', lambda _: self._on_login_click())
        self.email_entry.focus()

    # --------------------------------------------------------- Ações
    def _on_login_click(self):
        email = self.email_entry.get().strip()
        password = self.password_entry.get().strip()

        if not email or not password:
            self._set_status('Preencha todos os campos.', 'orange')
            return

        self.login_btn.configure(state='disabled', text='Validando...')
        self._set_status('Conectando ao servidor...', 'gray')

        # Validação em thread separada para não travar a GUI
        t = threading.Thread(target=self._validate, args=(email, password), daemon=True)
        t.start()

    def _validate(self, email: str, password: str):
        result = self.api_client.validate_user(email, password)
        # Volta para a thread principal (Tk) para atualizar a interface
        self.after(0, self._handle_result, result)

    def _handle_result(self, result):
        self.login_btn.configure(state='normal', text='ENTRAR')

        if result is None:
            self._set_status('Erro de conexão com o servidor.', '#ff4444')
            return

        if result.get('allowed'):
            user = result.get('user', {})
            name = user.get('fullName', 'Usuário')
            self._set_status(f'✓ Bem-vindo(a), {name}!', '#44ff44')

            # Reporta login ao servidor
            self.api_client.report_login(name)
            logger.info(f'Login autorizado: {name}')

            if self.on_login_success:
                self.on_login_success(result)

            # Fecha a janela após 2 s
            self.after(2000, self.destroy)
        else:
            reason = result.get('reason', 'UNKNOWN')
            messages = {
                'INVALID_CREDENTIALS': 'Email ou senha inválidos.',
                'NO_ACTIVE_ALLOCATION': 'Sem alocação ativa para esta máquina.',
                'MACHINE_MAINTENANCE': 'Máquina em manutenção.',
            }
            msg = messages.get(reason, result.get('message', 'Acesso negado.'))
            self._set_status(f'✗ {msg}', '#ff4444')

    def _set_status(self, text: str, color: str):
        self.status_label.configure(text=text, text_color=color)


# ------------------------------------------------------------------ API pública

def show_login(api_client: APIClient, on_success=None):
    """Abre a janela de login (bloqueante — roda o mainloop do Tk)."""
    app = LoginWindow(api_client, on_login_success=on_success)
    app.mainloop()
