package com.ciba.garcia

import org.junit.Assert.assertEquals
import org.junit.Test

class SpeechFriendlyTextTest {
    @Test
    fun removesMarkdownFormattingAndListMarkers() {
        val input = """
            Com base nas informações:
            *   **Interesse em Música:** Você gosta de **Rock N' Roll**.
            *   **Conexão:** Você acompanha a banda *Sexofone*.
        """.trimIndent()

        assertEquals(
            "Com base nas informações:. Interesse em Música: Você gosta de Rock N' Roll.. Conexão: Você acompanha a banda Sexofone.",
            speechFriendlyText(input)
        )
    }

    @Test
    fun removesParenthesesButKeepsTheirWords() {
        assertEquals("A resposta observação continua natural.", speechFriendlyText("A resposta (observação) continua natural."))
    }

    @Test
    fun readsLinkLabelsAndInlineCodeWithoutMarkup() {
        assertEquals("Abra o site oficial e veja a opção.", speechFriendlyText("Abra o [site oficial](https://example.com) e veja `a opção`."))
    }

    @Test
    fun skipsFencedCodeBlocks() {
        assertEquals("Segue a explicação.", speechFriendlyText("Segue a explicação.\n\n```kotlin\nval answer = 42\n```"))
    }
}
