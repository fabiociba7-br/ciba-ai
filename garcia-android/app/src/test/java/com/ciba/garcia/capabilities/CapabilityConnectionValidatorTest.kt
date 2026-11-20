package com.ciba.garcia.capabilities

import org.junit.Assert.*
import org.junit.Test

class CapabilityConnectionValidatorTest {
    private fun connection(endpoint: String = "https://api.example.com") = CapabilityConnection("conn-1", "Conta de teste", "http-api", endpoint, createdAtEpochMs = 1L)
    @Test fun catalogDoesNotClaimUnimplementedAdaptersAreReady() {
        assertEquals(CapabilitySupport.ADAPTER_REQUIRED, CapabilityCatalog.find("kaggle")?.support)
        assertEquals(CapabilitySupport.ASSISTED_ONLY, CapabilityCatalog.find("colab")?.support)
        assertEquals(CapabilitySupport.ADAPTER_REQUIRED, CapabilityCatalog.find("sftp")?.support)
    }
    @Test fun acceptsHttpsEndpoint() { assertNull(CapabilityConnectionValidator.validate(connection())) }
    @Test fun rejectsHttpEndpoint() { assertNotNull(CapabilityConnectionValidator.validate(connection("http://api.example.com"))) }
    @Test fun rejectsCredentialsInEndpoint() { assertNotNull(CapabilityConnectionValidator.validate(connection("https://user:pass@example.com"))) }
    @Test fun rejectsUnknownProvider() { assertNotNull(CapabilityConnectionValidator.validate(connection().copy(providerId = "unknown"))) }
    @Test fun rejectsBlankName() { assertNotNull(CapabilityConnectionValidator.validate(connection().copy(name = " "))) }
}
